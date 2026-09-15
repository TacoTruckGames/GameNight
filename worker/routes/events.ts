/**
 * The event board.
 *
 * `GET /api/events` is deliberately user-independent — no `myRsvp`, no
 * per-caller anything — so it can sit behind a per-colo edge cache later
 * without a redesign. The client derives "mine" from `GET /api/me/rsvps`.
 */

import { Hono } from "hono";

import type { AttendeesResponse, EventDetail } from "../../shared/api-types";
import { createEventSchema, eventsQuerySchema } from "../../shared/schemas";
import { getEventRow, hasRsvp, insertEvent, listAttendees, listUpcomingEvents, toEventSummary } from "../db/queries";
import type { AppEnv } from "../lib/context";
import { ApiError } from "../lib/errors";
import { nowIso, toIsoSeconds } from "../lib/time";
import { parseJson, parseQuery } from "../lib/validate";
import { requireOrganizer } from "../middleware/auth";

export const events = new Hono<AppEnv>();

/** `?q=` matches title or location; `?gameType=` is the chip filter. */
events.get("/events", async (c) => {
  const { q, gameType } = parseQuery(c, eventsQuerySchema);
  return c.json(await listUpcomingEvents(c.env.DB, { now: nowIso(), q, gameType }));
});

events.post("/events", async (c) => {
  const organizer = requireOrganizer(c);

  // `now` is read here, so "must be in the future" is judged against the moment
  // the server received the request rather than whatever the client believes.
  const input = await parseJson(c, createEventSchema(new Date()));

  const id = `evt_${crypto.randomUUID()}`;
  await insertEvent(c.env.DB, {
    id,
    organizerId: organizer.id,
    title: input.title,
    gameType: input.gameType,
    // Normalised to the one storage format, whatever offset the client sent.
    startsAt: toIsoSeconds(new Date(input.startsAt)),
    location: input.location,
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

  return c.json({ ...toEventSummary(row), myRsvp } satisfies EventDetail);
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
    event: toEventSummary(row),
    attendees: await listAttendees(c.env.DB, row.id),
  } satisfies AttendeesResponse);
});
