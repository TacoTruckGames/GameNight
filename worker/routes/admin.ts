/**
 * The operator surface: `/api/admin/*`, role `admin` only.
 *
 * Three conventions hold for every handler in this file:
 *
 * 1. **It starts with `requireAdmin(c)`.** There is no router-level middleware
 *    doing it, on purpose — a reader can see the gate on the handler they are
 *    reading, and a new route cannot be added without deciding about it.
 * 2. **Every mutation writes an audit row** (`worker/lib/audit.ts`): actor,
 *    action, target, and whatever a reader would need in `metadata`.
 * 3. **Anything that changes shared state goes through the same door the
 *    players use.** Removing an attendee calls the event's `EventRoom` rather
 *    than deleting the D1 row behind its back, and changing capacity rotates
 *    `room_key` so the room rehydrates. D1 is the system of record; the room is
 *    a cache of it, and the admin must not be the one who desynchronises them.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";

import type { AdminEventDetail, ApiFieldError } from "../../shared/api-types";
import {
  adminErrorsQuerySchema,
  adminEventPatchSchema,
  adminEventsQuerySchema,
  adminUsersQuerySchema,
  suspendSchema,
  type SuspendInput,
} from "../../shared/schemas";
import {
  adminGetEvent,
  adminGetEventRow,
  adminGetUser,
  adminListEvents,
  adminListUsers,
  adminOverview,
  adminSetEventStatus,
  adminSetSuspended,
  adminUpdateEvent,
  deleteError,
  getError,
  listAttendees,
  listAudit,
  listErrors,
  resolveError,
  toAdminEvent,
  type PlaceUpdate,
} from "../db/queries";
import { audit } from "../lib/audit";
import type { AppEnv } from "../lib/context";
import { ApiError } from "../lib/errors";
import { redact, resolvePlaceId } from "../lib/places";
import { reportError } from "../lib/report";
import { newRoomKey, roomFor } from "../lib/room";
import { nowIso, toIsoSeconds } from "../lib/time";
import { parseJson, parseQuery } from "../lib/validate";
import { requireAdmin } from "../middleware/auth";

export const admin = new Hono<AppEnv>();

const AUDIT_LIMIT_MAX = 200;

/**
 * `suspend` takes an optional body, and "no body at all" has to mean "no
 * reason" rather than a 400 — `fetch` with no `body` is the natural way for a
 * client to say that.
 */
async function readSuspendBody(c: Context<AppEnv>): Promise<SuspendInput> {
  const raw = await c.req.text();
  if (raw.trim() === "") return {};
  return parseJson(c, suspendSchema);
}

function fieldError(path: string, message: string): ApiFieldError[] {
  return [{ path, message }];
}

/**
 * **This is where the operator tool refuses to lie.**
 *
 * `POST /api/events` degrades silently when Google is unreachable: the
 * organizer wanted to post a game and the map is a garnish, so the event is
 * created with no place and the UI says so in one line. An admin editing an
 * event's venue is doing *only* that, deliberately, on a screen whose entire
 * purpose is fixing a wrong venue. Returning 200 with the old coordinates still
 * in the row would tell them the fix landed when it did not — and they would
 * close the tab.
 *
 * So the asymmetry is exact, and it is three cases:
 *   - `placeId: null`     → unlink. No network call; clearing always works.
 *   - `not_found`         → 400 on the `placeId` field. The id is stale; this is
 *                           the operator's problem and it is actionable.
 *   - anything else       → 503 `PLACE_UNAVAILABLE`, nothing written. Ours.
 *
 * `undefined` (the field absent) means "not editing the venue" and is the only
 * path that touches neither the network nor the place columns.
 */
async function resolvePlaceForPatch(
  c: Context<AppEnv>,
  placeId: string | null | undefined,
  sessionToken: string | undefined,
): Promise<PlaceUpdate | null> {
  if (placeId === undefined) return null;
  if (placeId === null) return { kind: "clear" };

  const outcome = await resolvePlaceId(c.env, c.env.DB, placeId, sessionToken);
  if (outcome.ok) return { kind: "set", place: outcome.place };

  if (outcome.reason === "not_found") {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      "Please fix the highlighted fields.",
      fieldError("placeId", "Google no longer recognises that place. Search for the venue again."),
    );
  }

  // "No key configured" is not a failure and never reaches the Errors page —
  // but it is still a 503 here, because nothing was written and saying
  // otherwise would be the lie this whole function exists to avoid.
  if (outcome.reason !== "unconfigured") {
    await reportError(c.env.DB, "places.details", new Error(`Place lookup failed: ${outcome.reason}`), {
      reason: outcome.reason,
      placeId: redact(placeId).slice(0, 128),
    });
  }

  throw new ApiError(
    503,
    "PLACE_UNAVAILABLE",
    "We couldn't confirm that venue just now, so nothing was changed. Try again in a moment.",
  );
}

// --------------------------------------------------------------- overview --

admin.get("/admin/overview", async (c) => {
  requireAdmin(c);
  return c.json(await adminOverview(c.env.DB, new Date()));
});

// ------------------------------------------------------------------ users --

admin.get("/admin/users", async (c) => {
  requireAdmin(c);
  const filters = parseQuery(c, adminUsersQuerySchema);
  return c.json(await adminListUsers(c.env.DB, filters));
});

/**
 * Suspension is one timestamp, enforced in `attachUser` — so it takes effect on
 * the suspended account's very next request, whatever route it was headed for.
 */
admin.post("/admin/users/:id/suspend", async (c) => {
  const actor = requireAdmin(c);
  const id = c.req.param("id");

  const target = await adminGetUser(c.env.DB, id);
  if (!target) throw new ApiError(404, "NOT_FOUND", "That user does not exist.");

  // Locking yourself out of the dashboard you are standing in is not a decision
  // anyone means to make.
  if (target.id === actor.id) {
    throw new ApiError(400, "VALIDATION_FAILED", "You can't suspend yourself");
  }

  const { reason } = await readSuspendBody(c);
  await adminSetSuspended(c.env.DB, id, true, reason ?? null, nowIso());
  await audit(c.env.DB, {
    actorId: actor.id,
    action: "user.suspended",
    targetType: "user",
    targetId: id,
    ...(reason ? { metadata: { reason } } : {}),
  });

  return c.json(await adminGetUser(c.env.DB, id));
});

admin.post("/admin/users/:id/unsuspend", async (c) => {
  const actor = requireAdmin(c);
  const id = c.req.param("id");

  const target = await adminGetUser(c.env.DB, id);
  if (!target) throw new ApiError(404, "NOT_FOUND", "That user does not exist.");

  await adminSetSuspended(c.env.DB, id, false, null, nowIso());
  await audit(c.env.DB, {
    actorId: actor.id,
    action: "user.unsuspended",
    targetType: "user",
    targetId: id,
  });

  return c.json(await adminGetUser(c.env.DB, id));
});

// ----------------------------------------------------------------- events --

admin.get("/admin/events", async (c) => {
  requireAdmin(c);
  const filters = parseQuery(c, adminEventsQuerySchema);
  return c.json(await adminListEvents(c.env.DB, { ...filters, now: nowIso() }));
});

/** The door list, for any event — the owning-organizer rule is the admin's to override. */
admin.get("/admin/events/:id", async (c) => {
  requireAdmin(c);
  const id = c.req.param("id");

  // The row rather than `adminGetEvent`, because `description` never travels on
  // a list shape — the admin list is lean for the same reason the board is — and
  // this is the route that has to show the operator the whole event.
  const row = await adminGetEventRow(c.env.DB, id);
  if (!row) throw new ApiError(404, "NOT_FOUND", "That event does not exist.");

  return c.json({
    ...toAdminEvent(row),
    description: row.description,
    attendees: await listAttendees(c.env.DB, id),
  } satisfies AdminEventDetail);
});

admin.patch("/admin/events/:id", async (c) => {
  const actor = requireAdmin(c);
  const id = c.req.param("id");

  const row = await adminGetEventRow(c.env.DB, id);
  if (!row) throw new ApiError(404, "NOT_FOUND", "That event does not exist.");

  const patch = await parseJson(c, adminEventPatchSchema(new Date()));

  // `events.rsvp_count <= capacity` is a CHECK constraint, so without this the
  // honest mistake "shrink the room" would arrive as an opaque 500. It is a
  // field error, on the field.
  if (patch.capacity !== undefined && patch.capacity < row.rsvp_count) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      "Please fix the highlighted fields.",
      fieldError("capacity", `Capacity can't be below the ${row.rsvp_count} current attendees`),
    );
  }

  // Hazard 1: a hydrated `EventRoom` caches capacity and answers "full" from
  // that cache without ever reading D1, so a raise would be invisible to the
  // players it was meant for. A rotated key names a room that does not exist
  // yet; it hydrates from D1 — the new capacity — on its next call. It goes in
  // the same UPDATE as the capacity, so the two can never disagree.
  const rotate = patch.capacity !== undefined && patch.capacity !== row.capacity ? newRoomKey() : null;

  // Resolved *before* the UPDATE, so a failed lookup writes nothing at all.
  const place = await resolvePlaceForPatch(c, patch.placeId, patch.placeSessionToken);

  const changed = await adminUpdateEvent(
    c.env.DB,
    id,
    // Normalise to the one storage format, whatever offset the client sent.
    { ...patch, ...(patch.startsAt !== undefined ? { startsAt: toIsoSeconds(new Date(patch.startsAt)) } : {}) },
    rotate,
    place,
  );

  await audit(c.env.DB, {
    actorId: actor.id,
    action: "event.updated",
    targetType: "event",
    targetId: id,
    metadata: { changed, ...(rotate ? { roomRotated: true } : {}) },
  });

  return c.json(await adminGetEvent(c.env.DB, id));
});

/**
 * Cancel and restore, both idempotent. Cancelling is a status change, never a
 * delete: the RSVP rows stay so the people who were coming still see the event
 * (marked cancelled) in "My RSVP", and the audit trail keeps its target.
 */
admin.post("/admin/events/:id/cancel", async (c) => {
  const actor = requireAdmin(c);
  const id = c.req.param("id");

  const row = await adminGetEventRow(c.env.DB, id);
  if (!row) throw new ApiError(404, "NOT_FOUND", "That event does not exist.");

  await adminSetEventStatus(c.env.DB, id, "cancelled", nowIso());
  await audit(c.env.DB, { actorId: actor.id, action: "event.cancelled", targetType: "event", targetId: id });

  return c.json(await adminGetEvent(c.env.DB, id));
});

admin.post("/admin/events/:id/restore", async (c) => {
  const actor = requireAdmin(c);
  const id = c.req.param("id");

  const row = await adminGetEventRow(c.env.DB, id);
  if (!row) throw new ApiError(404, "NOT_FOUND", "That event does not exist.");

  await adminSetEventStatus(c.env.DB, id, "scheduled", nowIso());
  await audit(c.env.DB, { actorId: actor.id, action: "event.restored", targetType: "event", targetId: id });

  return c.json(await adminGetEvent(c.env.DB, id));
});

/**
 * Hazard 2: deleting the `rsvps` row directly would leave the room still
 * holding the player in `members`, so it would answer their next RSVP with
 * `already_confirmed` and never give the seat back. Going through
 * `room.cancel()` is the same path the player's own DELETE takes, which is why
 * it is the right one — D1 and the room move together, in one transaction.
 */
admin.delete("/admin/events/:id/attendees/:playerId", async (c) => {
  const actor = requireAdmin(c);
  const id = c.req.param("id");
  const playerId = c.req.param("playerId");

  const row = await adminGetEventRow(c.env.DB, id);
  if (!row) throw new ApiError(404, "NOT_FOUND", "That event does not exist.");

  // `not_attending` is a 200 too: the caller asked for "this player has no
  // seat", and they do not.
  const outcome = await roomFor(c.env, row).cancel(id, playerId);

  await audit(c.env.DB, {
    actorId: actor.id,
    action: "event.attendee_removed",
    targetType: "event",
    targetId: id,
    metadata: { playerId, outcome: outcome.kind },
  });

  return c.json({ attendeeCount: outcome.attendeeCount, capacity: outcome.capacity });
});

// ----------------------------------------------------------------- errors --

admin.get("/admin/errors", async (c) => {
  requireAdmin(c);
  const { status } = parseQuery(c, adminErrorsQuerySchema);
  return c.json(await listErrors(c.env.DB, status ?? "open"));
});

/**
 * Deliberately throws.
 *
 * An error log nobody has ever seen work is an error log nobody trusts, so the
 * operator gets a button that proves the whole pipeline — throw → `onError` →
 * fingerprint → `error_log` → the Errors page — in one click. The 500 it
 * returns is the successful outcome, and the tests assert exactly that.
 */
admin.post("/admin/errors/probe", (c) => {
  requireAdmin(c);
  throw new Error("Probe error from admin dashboard");
});

admin.post("/admin/errors/:id/resolve", async (c) => {
  const actor = requireAdmin(c);
  const id = c.req.param("id");

  const row = await getError(c.env.DB, id);
  if (!row) throw new ApiError(404, "NOT_FOUND", "That error does not exist.");

  await resolveError(c.env.DB, id, nowIso());
  await audit(c.env.DB, {
    actorId: actor.id,
    action: "error.resolved",
    targetType: "error",
    targetId: id,
    metadata: { fingerprint: row.fingerprint },
  });

  return c.json({ ok: true });
});

admin.delete("/admin/errors/:id", async (c) => {
  const actor = requireAdmin(c);
  const id = c.req.param("id");

  const row = await getError(c.env.DB, id);
  if (!row) throw new ApiError(404, "NOT_FOUND", "That error does not exist.");

  await deleteError(c.env.DB, id);
  await audit(c.env.DB, {
    actorId: actor.id,
    action: "error.dismissed",
    targetType: "error",
    targetId: id,
    metadata: { fingerprint: row.fingerprint },
  });

  return c.json({ ok: true });
});

// ------------------------------------------------------------------ audit --

const auditQuerySchema = z.object({
  limit: z.preprocess(
    (value) => (typeof value === "string" && value !== "" ? Number(value) : value),
    z.int().min(1).max(AUDIT_LIMIT_MAX).optional(),
  ),
});

admin.get("/admin/audit", async (c) => {
  requireAdmin(c);
  const { limit } = parseQuery(c, auditQuerySchema);
  return c.json(await listAudit(c.env.DB, limit ?? 50));
});
