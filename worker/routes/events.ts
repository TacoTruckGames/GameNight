/**
 * The event board.
 *
 * `GET /api/events` is deliberately user-independent — no `myRsvp`, no
 * per-caller anything — so it can sit behind a per-colo edge cache later
 * without a redesign. The client derives "mine" from `GET /api/me/rsvps`.
 */

import { Hono } from "hono";

import type { AttendeesResponse } from "../../shared/api-types";
import { createEventSchema, eventPatchSchema, eventsQuerySchema } from "../../shared/schemas";
import {
  deleteEvent,
  getEventRow,
  hasRsvp,
  insertEvent,
  listAttendees,
  listEvents,
  setEventStatus,
  toEventDetail,
  toEventSummary,
  type ResolvedPlace,
} from "../db/queries";
import type { AppEnv } from "../lib/context";
import { ApiError } from "../lib/errors";
import { redact, resolvePlaceId } from "../lib/places";
import { reportError } from "../lib/report";
import { applyEventPatch } from "../lib/event-edit";
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
    roomKey: newRoomKey(),
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
  return c.json(toEventDetail(row, myRsvp));
});

/**
 * The gate every owner-only write goes through: signed in as an organizer, the
 * event exists, and it is theirs. Ownership is read off the row, never off
 * anything the client sent. Auth is checked before the lookup so an outsider
 * cannot learn which ids exist by which error they get back.
 */
async function requireOwnedEvent(c: Parameters<typeof requireOrganizer>[0], id: string) {
  const organizer = requireOrganizer(c);
  const row = await getEventRow(c.env.DB, id);
  if (!row) throw new ApiError(404, "NOT_FOUND", "That event does not exist.");
  if (row.organizer_id !== organizer.id) {
    throw new ApiError(403, "FORBIDDEN", "That event belongs to a different organizer.");
  }
  return row;
}

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
  const id = c.req.param("id");
  const row = await requireOwnedEvent(c, id);
  if (row.status === "cancelled") {
    throw new ApiError(409, "EVENT_CANCELLED", "This event was cancelled, so it can no longer be edited.");
  }

  // `now` is the server's, so "must be in the future" is judged against the
  // moment the request landed rather than whatever the client believes.
  const patch = await parseJson(c, eventPatchSchema(new Date()));

  // The floor, the room rotation, the venue lookup and the write — the same
  // pipeline the admin's patch runs, in `lib/event-edit.ts`.
  await applyEventPatch(c, id, row, patch);

  const updated = await getEventRow(c.env.DB, id);
  if (!updated) throw new ApiError(500, "INTERNAL", "The event could not be read back after the update.");
  return c.json(toEventDetail(updated, null));
});

/**
 * The organizer calls it off.
 *
 * A status change, never a delete — the same rule the admin's cancel follows,
 * and for the same reason: the RSVP rows stay, so everyone who was coming sees
 * the event marked cancelled in their own list rather than watching it vanish.
 * Idempotent, because a second tap on a slow connection is not a second event.
 * Only an admin can restore, and that is deliberate: un-cancelling re-promises
 * seats to people who may have made other plans, and it belongs to the person
 * who can also see the error log.
 */
events.post("/events/:id/cancel", async (c) => {
  const id = c.req.param("id");
  const row = await requireOwnedEvent(c, id);
  if (row.status !== "cancelled") await setEventStatus(c.env.DB, id, "cancelled", nowIso());

  const updated = await getEventRow(c.env.DB, id);
  if (!updated) throw new ApiError(500, "INTERNAL", "The event could not be read back.");
  return c.json(toEventDetail(updated, null));
});

/**
 * Gone — but only while nobody holds a seat.
 *
 * "Delete" is the verb an organizer reaches for on an event they posted by
 * mistake, and for one nobody has joined it is the right verb: there is no one
 * to tell. The moment someone has a seat the right verb is cancel, because a
 * deletion would silently remove the event from that person's list with no
 * explanation, and the 409 says so in words.
 */
events.delete("/events/:id", async (c) => {
  const id = c.req.param("id");
  const row = await requireOwnedEvent(c, id);
  if (row.rsvp_count > 0) {
    throw new ApiError(
      409,
      "EVENT_HAS_RSVPS",
      `${row.rsvp_count === 1 ? "1 person has" : `${row.rsvp_count} people have`} a seat. Cancel the event instead, so they find out.`,
    );
  }
  await deleteEvent(c.env.DB, id);
  return c.body(null, 204);
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
