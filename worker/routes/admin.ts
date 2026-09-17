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
import { applyEventPatch } from "../lib/event-edit";
import type { Context } from "hono";
import { z } from "zod";

import type { AdminEventDetail } from "../../shared/api-types";
import {
  adminErrorsQuerySchema,
  adminEventsQuerySchema,
  eventPatchSchema,
  adminUsersQuerySchema,
  suspendSchema,
  type SuspendInput, intFromQuery } from "../../shared/schemas";
import {
  adminGetEvent,
  adminGetEventRow,
  adminGetUser,
  adminListEvents,
  adminListUsers,
  adminOverview,
  setEventStatus,
  adminSetSuspended,
  deleteError,
  getError,
  listAttendees,
  listAudit,
  listErrors,
  resolveError,
  toAdminEvent,
} from "../db/queries";
import { audit } from "../lib/audit";
import type { AppEnv } from "../lib/context";
import { ApiError } from "../lib/errors";
import { roomFor } from "../lib/room";
import { nowIso } from "../lib/time";
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

  const patch = await parseJson(c, eventPatchSchema(new Date()));

  // Hazard 1 lives in `lib/event-edit.ts` with the rest of the pipeline: the
  // room key rotates in the same UPDATE as a capacity change, so a hydrated
  // room can never keep answering "full" from a stale cache.
  const { changed, rotated } = await applyEventPatch(c, id, row, patch);

  await audit(c.env.DB, {
    actorId: actor.id,
    action: "event.updated",
    targetType: "event",
    targetId: id,
    metadata: { changed, ...(rotated ? { roomRotated: true } : {}) },
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

  await setEventStatus(c.env.DB, id, "cancelled", nowIso());
  await audit(c.env.DB, { actorId: actor.id, action: "event.cancelled", targetType: "event", targetId: id });

  return c.json(await adminGetEvent(c.env.DB, id));
});

admin.post("/admin/events/:id/restore", async (c) => {
  const actor = requireAdmin(c);
  const id = c.req.param("id");

  const row = await adminGetEventRow(c.env.DB, id);
  if (!row) throw new ApiError(404, "NOT_FOUND", "That event does not exist.");

  await setEventStatus(c.env.DB, id, "scheduled", nowIso());
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
  limit: z.preprocess(intFromQuery, z.int().min(1).max(AUDIT_LIMIT_MAX).optional()),
});

admin.get("/admin/audit", async (c) => {
  requireAdmin(c);
  const { limit } = parseQuery(c, auditQuerySchema);
  return c.json(await listAudit(c.env.DB, limit ?? 50));
});
