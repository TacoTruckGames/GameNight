/**
 * The RSVP contract, one request at a time. The *simultaneous* version of the
 * same contract lives in `test/concurrency/`.
 */

import { describe, expect, it } from "vitest";

import type { ApiErrorBody, EventSummary, RsvpResponse } from "../../shared/api-types";
import { api, deleteRsvp, inDays, projectedCount, putRsvp, rsvpCount, seedEvent, seedUser, seedUsers } from "../helpers";

describe("PUT /api/events/:id/rsvp", () => {
  it("confirms a seat with 201, then answers a retry with 200 and no second row", async () => {
    const player = await seedUser();
    const event = await seedEvent({ capacity: 4 });

    const first = await putRsvp(event.id, player.id);
    expect(first.status).toBe(201);
    expect(first.body).toEqual({ status: "confirmed", attendeeCount: 1, capacity: 4, seatsLeft: 3 });

    // S2: the client may safely retry a PUT whose response it never saw.
    const retry = await putRsvp(event.id, player.id);
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual({ status: "already_confirmed", attendeeCount: 1, capacity: 4, seatsLeft: 3 });

    expect(await rsvpCount(event.id)).toBe(1);
    expect(await projectedCount(event.id)).toBe(1);
  });

  it("409s EVENT_FULL on a full event and leaves the count untouched", async () => {
    const seated = await seedUsers(3);
    const latecomer = await seedUser();
    const event = await seedEvent({ capacity: 3, rsvpPlayerIds: seated.map((player) => player.id) });

    const { status, body } = (await putRsvp(event.id, latecomer.id)) as { status: number; body: ApiErrorBody };

    expect(status).toBe(409);
    expect(body.error.code).toBe("EVENT_FULL");
    expect(await rsvpCount(event.id)).toBe(3);
    expect(await projectedCount(event.id)).toBe(3);
  });

  it("409s EVENT_STARTED for an event in the past", async () => {
    const player = await seedUser();
    const event = await seedEvent({ startsAt: inDays(-1) });

    const { status, body } = (await putRsvp(event.id, player.id)) as { status: number; body: ApiErrorBody };

    expect(status).toBe(409);
    expect(body.error.code).toBe("EVENT_STARTED");
    expect(await rsvpCount(event.id)).toBe(0);
  });

  it("404s for an unknown event", async () => {
    const player = await seedUser();
    const { status, body } = (await putRsvp(`evt_${crypto.randomUUID()}`, player.id)) as {
      status: number;
      body: ApiErrorBody;
    };

    expect(status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("403s for an organizer", async () => {
    const organizer = await seedUser({ role: "organizer" });
    const event = await seedEvent();

    const { status, body } = (await putRsvp(event.id, organizer.id)) as { status: number; body: ApiErrorBody };

    expect(status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(await rsvpCount(event.id)).toBe(0);
  });

  it("401s when signed out", async () => {
    const event = await seedEvent();
    const { status, body } = await api<ApiErrorBody>(`/api/events/${event.id}/rsvp`, { method: "PUT" });

    expect(status).toBe(401);
    expect(body.error.code).toBe("AUTH_REQUIRED");
  });

  it("401s UNKNOWN_USER for a stale identity", async () => {
    const event = await seedEvent();
    const { status, body } = (await putRsvp(event.id, `u_${crypto.randomUUID()}`)) as {
      status: number;
      body: ApiErrorBody;
    };

    expect(status).toBe(401);
    expect(body.error.code).toBe("UNKNOWN_USER");
  });
});

describe("DELETE /api/events/:id/rsvp", () => {
  it("cancels, then reports not_attending on a repeat — both 200", async () => {
    const player = await seedUser();
    const event = await seedEvent({ capacity: 4 });

    await putRsvp(event.id, player.id);

    const first = await deleteRsvp(event.id, player.id);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ status: "cancelled", attendeeCount: 0, capacity: 4, seatsLeft: 4 });

    const repeat = await deleteRsvp(event.id, player.id);
    expect(repeat.status).toBe(200);
    expect(repeat.body).toEqual({ status: "not_attending", attendeeCount: 0, capacity: 4, seatsLeft: 4 });

    expect(await rsvpCount(event.id)).toBe(0);
    expect(await projectedCount(event.id)).toBe(0);
  });

  it("is a 200 not_attending even if the player never RSVPed", async () => {
    const player = await seedUser();
    const event = await seedEvent();

    const { status, body } = await deleteRsvp(event.id, player.id);
    expect(status).toBe(200);
    expect((body as RsvpResponse).status).toBe("not_attending");
  });

  it("lets a cancelled player RSVP again", async () => {
    const player = await seedUser();
    const event = await seedEvent({ capacity: 2 });

    expect((await putRsvp(event.id, player.id)).status).toBe(201);
    expect((await deleteRsvp(event.id, player.id)).status).toBe(200);

    const again = await putRsvp(event.id, player.id);
    expect(again.status).toBe(201);
    expect((again.body as RsvpResponse).status).toBe("confirmed");
    expect(await rsvpCount(event.id)).toBe(1);
  });

  it("frees the seat for someone else", async () => {
    const [incumbent, waiting] = await seedUsers(2);
    const event = await seedEvent({ capacity: 1 });

    expect((await putRsvp(event.id, incumbent!.id)).status).toBe(201);
    expect((await putRsvp(event.id, waiting!.id)).status).toBe(409);

    await deleteRsvp(event.id, incumbent!.id);

    expect((await putRsvp(event.id, waiting!.id)).status).toBe(201);
    expect(await rsvpCount(event.id)).toBe(1);
    expect(await projectedCount(event.id)).toBe(1);
  });

  it("allows cancelling a past event", async () => {
    const player = await seedUser();
    const event = await seedEvent({ startsAt: inDays(-2), rsvpPlayerIds: [player.id] });

    const { status, body } = await deleteRsvp(event.id, player.id);
    expect(status).toBe(200);
    expect((body as RsvpResponse).status).toBe("cancelled");
  });

  it("404s for an unknown event", async () => {
    const player = await seedUser();
    const { status } = await deleteRsvp(`evt_${crypto.randomUUID()}`, player.id);
    expect(status).toBe(404);
  });

  it("403s for an organizer", async () => {
    const organizer = await seedUser({ role: "organizer" });
    const event = await seedEvent();
    const { status } = await deleteRsvp(event.id, organizer.id);
    expect(status).toBe(403);
  });
});

describe("GET /api/me/rsvps", () => {
  it("lists the player's upcoming events, soonest first, and drops cancelled ones", async () => {
    const player = await seedUser();
    const later = await seedEvent({ startsAt: inDays(20) });
    const sooner = await seedEvent({ startsAt: inDays(10) });
    const past = await seedEvent({ startsAt: inDays(-5), rsvpPlayerIds: [player.id] });
    const notMine = await seedEvent({ startsAt: inDays(15) });

    await putRsvp(later.id, player.id);
    await putRsvp(sooner.id, player.id);

    const { status, body } = await api<EventSummary[]>("/api/me/rsvps", { as: player.id });

    expect(status).toBe(200);
    expect(body.map((event) => event.id)).toEqual([sooner.id, later.id]);
    expect(body.map((event) => event.id)).not.toContain(past.id);
    expect(body.map((event) => event.id)).not.toContain(notMine.id);

    await deleteRsvp(sooner.id, player.id);
    const after = await api<EventSummary[]>("/api/me/rsvps", { as: player.id });
    expect(after.body.map((event) => event.id)).toEqual([later.id]);
  });

  it("403s for an organizer and 401s when signed out", async () => {
    const organizer = await seedUser({ role: "organizer" });
    expect((await api("/api/me/rsvps", { as: organizer.id })).status).toBe(403);
    expect((await api("/api/me/rsvps")).status).toBe(401);
  });
});
