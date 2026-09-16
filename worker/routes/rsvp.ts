/**
 * RSVP and cancel — the only two writes that can race.
 *
 * Both are `PUT`/`DELETE` rather than `POST` because both are idempotent *by
 * contract*: repeating one can never create a second seat or a second
 * cancellation. That is what makes it safe for the client to retry a request
 * whose response it never saw, which is the realistic shape of the duplicate
 * problem (S2) — a flaky network, not a double-click.
 *
 * This route is thin on purpose. It resolves the event, rejects the cases that
 * have nothing to do with concurrency (unknown event, wrong role, event already
 * started), then hands the decision to the event's `EventRoom`.
 */

import { Hono } from "hono";
import type { Context } from "hono";

import type { RsvpResponse } from "../../shared/api-types";
import type { CancelOutcome, RsvpOutcome } from "../do/EventRoom";
import { getEventRow, type EventRow } from "../db/queries";
import type { AppEnv } from "../lib/context";
import { ApiError } from "../lib/errors";
import { reportError } from "../lib/report";
import { roomFor } from "../lib/room";
import { nowIso } from "../lib/time";
import { requirePlayer } from "../middleware/auth";

export const rsvp = new Hono<AppEnv>();

async function loadEvent(c: Context<AppEnv>, id: string): Promise<EventRow> {
  const row = await getEventRow(c.env.DB, id);
  if (!row) throw new ApiError(404, "NOT_FOUND", "That event does not exist.");
  return row;
}

function toResponse(status: RsvpResponse["status"], outcome: RsvpOutcome | CancelOutcome): RsvpResponse {
  return {
    status,
    attendeeCount: outcome.attendeeCount,
    capacity: outcome.capacity,
    seatsLeft: Math.max(0, outcome.capacity - outcome.attendeeCount),
  };
}

/**
 * A DO or D1 failure is a 503, never a 500: nothing was written that the caller
 * needs to reason about, and the verb is idempotent, so "try again" is honest
 * and safe advice.
 *
 * Because it is a handled 503 it never reaches `onError`'s reporting branch, so
 * it records itself — a room that has started failing is precisely what an
 * operator wants on the Errors page.
 */
async function unavailable(
  db: D1Database,
  error: unknown,
  metadata: Record<string, unknown>,
): Promise<ApiError> {
  await reportError(db, "rsvp.room", error, metadata);
  return new ApiError(503, "RSVP_UNAVAILABLE", "Could not save your RSVP, please retry.");
}

rsvp.put("/events/:id/rsvp", async (c) => {
  const player = requirePlayer(c);
  const event = await loadEvent(c, c.req.param("id"));

  // Matches the list filter (`starts_at >= now`), so anything visible on the
  // board is always RSVP-able.
  if (event.starts_at < nowIso()) {
    throw new ApiError(409, "EVENT_STARTED", "This event has already started.");
  }

  // An admin called this one off. Cancelling an existing RSVP still works (see
  // the DELETE below) — only taking a new seat is refused.
  if (event.status === "cancelled") {
    throw new ApiError(409, "EVENT_CANCELLED", "This event was cancelled.");
  }

  let outcome: RsvpOutcome;
  try {
    outcome = await roomFor(c.env, event).rsvp(event.id, player.id);
  } catch (error) {
    throw await unavailable(c.env.DB, error, { eventId: event.id, playerId: player.id, op: "rsvp" });
  }

  switch (outcome.kind) {
    case "created":
      return c.json(toResponse("confirmed", outcome), 201);
    case "already":
      return c.json(toResponse("already_confirmed", outcome), 200);
    case "full":
      throw new ApiError(409, "EVENT_FULL", "This event just filled up.");
  }
});

rsvp.delete("/events/:id/rsvp", async (c) => {
  const player = requirePlayer(c);
  // Cancelling a past event is allowed — there is no harm in it, and refusing
  // would strand anyone whose plans changed after the start time.
  const event = await loadEvent(c, c.req.param("id"));

  let outcome: CancelOutcome;
  try {
    outcome = await roomFor(c.env, event).cancel(event.id, player.id);
  } catch (error) {
    throw await unavailable(c.env.DB, error, { eventId: event.id, playerId: player.id, op: "cancel" });
  }

  return c.json(toResponse(outcome.kind === "cancelled" ? "cancelled" : "not_attending", outcome), 200);
});
