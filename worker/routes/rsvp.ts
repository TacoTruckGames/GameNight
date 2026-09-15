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
import type { CancelOutcome, EventRoom, RsvpOutcome } from "../do/EventRoom";
import { getEventRow, type EventRow } from "../db/queries";
import type { AppEnv } from "../lib/context";
import { ApiError } from "../lib/errors";
import { nowIso } from "../lib/time";
import { requirePlayer } from "../middleware/auth";

export const rsvp = new Hono<AppEnv>();

/**
 * The room name is `${eventId}:${room_key}`. The salt means an event can be
 * given a fresh, empty room by rotating one column — it re-hydrates from D1 on
 * the next call — without inventing a new event id.
 */
function roomFor(env: Env, event: EventRow): DurableObjectStub<EventRoom> {
  return env.EVENT_ROOM.get(env.EVENT_ROOM.idFromName(`${event.id}:${event.room_key}`));
}

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
 */
function unavailable(error: unknown): ApiError {
  console.error("EventRoom call failed", error);
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

  let outcome: RsvpOutcome;
  try {
    outcome = await roomFor(c.env, event).rsvp(event.id, player.id);
  } catch (error) {
    throw unavailable(error);
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
    throw unavailable(error);
  }

  return c.json(toResponse(outcome.kind === "cancelled" ? "cancelled" : "not_attending", outcome), 200);
});
