/**
 * The event board.
 *
 * `GET /api/events` is deliberately user-independent — no `myRsvp`, no
 * per-caller anything — so it can sit behind a per-colo edge cache later
 * without a redesign. The client derives "mine" from `GET /api/me/rsvps`.
 */

import { Hono } from "hono";

import type { AttendeesResponse, EventDetail } from "../../shared/api-types";
import { createEventSchema, eventPatchSchema, eventsQuerySchema } from "../../shared/schemas";
import {
  getEventRow,
  hasRsvp,
  insertEvent,
  listAttendees,
  listEvents,
  toEventSummary,
  updateEvent,
  type ResolvedPlace,
} from "../db/queries";
import type { AppEnv } from "../lib/context";
import { ApiError, fieldError } from "../lib/errors";
import { redact, resolvePlaceForPatch, resolvePlaceId } from "../lib/places";
import { reportError } from "../lib/report";
import { newRoomKey } from "../lib/room";
import { nowIso, toIsoSeconds, toStorageWindow } from "../lib/time";
import { parseJson, parseQuery } from "../lib/validate";
import { requireOrganizer } from "../middleware/auth";

export const events = new Hono<AppEnv>();

/**
 * Turn the one piece of place data a client may send — an opaque id — into the
 * columns we store, and **never fail**.
 *
 * That is the whole contract, and it is why the signature returns
 * `ResolvedPlace | null` rather than a result type. Posting an event is the
 * core action of this product; a map pin is a garnish. A third-party outage,
 * an exhausted budget or a key nobody has configured yet must all end the same
 * way: the event is created, `place` is `null`, and `location` still says
 * exactly what the organizer typed. The client's job is then one honest line of
 * copy, not an error.
 *
 * A configuration absence is not reported — see `routes/places.ts`. Everything
 * else is, so an operator can tell "we are degraded" from "we are switched off".
 */
async function resolveForCreate(
  env: Env,
  db: D1Database,
  placeId: string | null | undefined,
  sessionToken: string | undefined,
): Promise<ResolvedPlace | null> {
  if (!placeId) return null;
  try {
    const outcome = await resolvePlaceId(env, db, placeId, sessionToken);
    if (outcome.ok) return outcome.place;
    if (outcome.reason === "unconfigured") return null;
    await reportError(db, "places.details", new Error(`Place lookup failed: ${outcome.reason}`), {
      reason: outcome.reason,
      placeId: redact(placeId).slice(0, 128),
    });
  } catch (error) {
    // Belt and braces: `resolvePlaceId` is written not to throw, and if that
    // ever stops being true it must still not cost an organizer their event.
    await reportError(db, "places.details", error, { placeId: redact(placeId).slice(0, 128) });
  }
  return null;
}

/**
 * `?q=` matches title or location; `?gameType=` is the chip filter; `?sort=`
 * is `date` (default) or `popular`.
 *
 * `?from=&to=` is the optional date window, half-open (`from` inclusive, `to`
 * exclusive). Without it the answer is the upcoming board — `starts_at >= now`,
 * the default this endpoint can be edge-cached on. With it, `now` no longer
 * applies and past events come back, which is what the calendar's month grid
 * asks for. Both or neither: the schema 400s on half a window rather than
 * guessing the end the caller left out.
 *
 * Both ends are normalised to the storage format (UTC, second precision)
 * because `starts_at >=` is a *string* comparison — a client sending an offset
 * or milliseconds must not quietly compare wrong. See `worker/lib/time.ts`.
 */
events.get("/events", async (c) => {
  const { q, gameType, sort, ...window } = parseQuery(c, eventsQuerySchema);
  return c.json(
    await listEvents(c.env.DB, {
      now: nowIso(),
      q,
      gameType,
      sort,
      ...toStorageWindow(window),
    }),
  );
});

events.post("/events", async (c) => {
  const organizer = requireOrganizer(c);

  // `now` is read here, so "must be in the future" is judged against the moment
  // the server received the request rather than whatever the client believes.
  const input = await parseJson(c, createEventSchema(new Date()));

  const place = await resolveForCreate(c.env, c.env.DB, input.placeId, input.placeSessionToken);

  const id = `evt_${crypto.randomUUID()}`;
  await insertEvent(c.env.DB, {
    id,
    place,
    organizerId: organizer.id,
    title: input.title,
    gameType: input.gameType,
    // Normalised to the one storage format, whatever offset the client sent.
    startsAt: toIsoSeconds(new Date(input.startsAt)),
    location: input.location,
    // Already trimmed, and already `undefined` if the textarea was blank.
    description: input.description,
    capacity: input.capacity,
    // Salts the Durable Object name. Rotating it hands the event a brand-new,
    // empty room that rehydrates from D1 — the manual recovery lever.
    roomKey: crypto.randomUUID().replaceAll("-", "").slice(0, 16),
  });

  const row = await getEventRow(c.env.DB, id);
  if (!row) throw new ApiError(500, "INTERNAL", "The event could not be read back after creation.");
  return c.json(toEventSummary(row), 201);
});

events.get("/events/:id", async (c) => {
  const row = await getEventRow(c.env.DB, c.req.param("id"));
  if (!row) throw new ApiError(404, "NOT_FOUND", "That event does not exist.");

  const user = c.get("user");
  // `null`, not `false`, when nobody is signed in (or the caller is an
  // organizer, who cannot RSVP): "unknown" and "not going" are different
  // things to the UI.
  const myRsvp = user && user.role === "player" ? await hasRsvp(c.env.DB, row.id, user.id) : null;

  // `description` is added here rather than in `toEventSummary`, because this is
  // the only public route that sends it — the board's cards have no room for
  // prose and no reason to carry 50 of them. Null is the ordinary "none" case.
  return c.json({
    ...toEventSummary(row),
    description: row.description,
    myRsvp,
    organizerId: row.organizer_id,
  } satisfies EventDetail);
});

/**
 * The organizer's own edit. Same schema and same write as the admin's patch —
 * see `eventPatchSchema` — differing only in who may call it: the admin may fix
 * anybody's event, an organizer may fix the ones that are theirs.
 *
 * Ownership is checked against the row, never against anything the client sent.
 * A cancelled event is refused: only an admin can restore one, so editing it
 * would be filing changes into something nobody can see, with nothing on screen
 * to say why. 409 rather than 403 — the caller is allowed, the event is not in
 * a state to take it.
 *
 * Deliberately **not** audited. `audit()` writes the operator trail the admin
 * dashboard reads as "recent admin actions", and an organizer editing their own
 * table is not one. Giving those rows an actor role to distinguish them is the
 * right fix and a bigger one than this route.
 */
events.patch("/events/:id", async (c) => {
  const organizer = requireOrganizer(c);
  const id = c.req.param("id");

  const row = await getEventRow(c.env.DB, id);
  if (!row) throw new ApiError(404, "NOT_FOUND", "That event does not exist.");
  if (row.organizer_id !== organizer.id) {
    throw new ApiError(403, "FORBIDDEN", "That event belongs to a different organizer.");
  }
  if (row.status === "cancelled") {
    throw new ApiError(409, "EVENT_CANCELLED", "This event was cancelled, so it can no longer be edited.");
  }

  // `now` is the server's, so "must be in the future" is judged against the
  // moment the request landed rather than whatever the client believes.
  const patch = await parseJson(c, eventPatchSchema(new Date()));

  // `events.rsvp_count <= capacity` is a CHECK constraint, so without this the
  // honest mistake "shrink the room" arrives as an opaque 500. It is a field
  // error, on the field.
  if (patch.capacity !== undefined && patch.capacity < row.rsvp_count) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      "Please fix the highlighted fields.",
      fieldError("capacity", `Capacity can't be below the ${row.rsvp_count} current attendees`),
    );
  }

  // A hydrated `EventRoom` caches capacity and answers "full" from that cache
  // without reading D1, so a raise would be invisible to the players it was for.
  // A rotated key names a room that does not exist yet; it hydrates from D1 on
  // its next call. It is written in the same UPDATE as the capacity, so the two
  // can never disagree.
  const rotate = patch.capacity !== undefined && patch.capacity !== row.capacity ? newRoomKey() : null;

  // Resolved *before* the UPDATE, so a failed lookup writes nothing at all.
  const place = await resolvePlaceForPatch(c, patch.placeId, patch.placeSessionToken);

  await updateEvent(
    c.env.DB,
    id,
    // Normalise to the one storage format, whatever offset the client sent.
    { ...patch, ...(patch.startsAt !== undefined ? { startsAt: toIsoSeconds(new Date(patch.startsAt)) } : {}) },
    rotate,
    place,
  );

  const updated = await getEventRow(c.env.DB, id);
  if (!updated) throw new ApiError(500, "INTERNAL", "The event could not be read back after the update.");
  return c.json({
    ...toEventSummary(updated),
    description: updated.description,
    myRsvp: null,
    organizerId: updated.organizer_id,
  } satisfies EventDetail);
});

/** Owning organizer only — the door list is not public. */
events.get("/events/:id/attendees", async (c) => {
  const organizer = requireOrganizer(c);

  const row = await getEventRow(c.env.DB, c.req.param("id"));
  if (!row) throw new ApiError(404, "NOT_FOUND", "That event does not exist.");
  if (row.organizer_id !== organizer.id) {
    throw new ApiError(403, "FORBIDDEN", "That event belongs to a different organizer.");
  }

  return c.json({
    // `description` is added here rather than in `toEventSummary` for the same
    // reason the detail route adds it: the list shapes have no room for prose
    // and no reason to carry fifty of them, and the row is already read.
    event: { ...toEventSummary(row), description: row.description },
    attendees: await listAttendees(c.env.DB, row.id),
  } satisfies AttendeesResponse);
});
