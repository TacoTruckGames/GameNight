/**
 * Cold rooms, through real HTTP.
 *
 * `seed/seed.sql` writes events and RSVPs straight into D1 and never touches a
 * Durable Object, so on a freshly seeded database *every* `EventRoom` is cold.
 * If hydration were wrong, the demo board would be wrong — the FULL event would
 * accept RSVPs and the near-full one would over-book. These tests use the same
 * seeding shape as the SQL file and only ever talk to the API.
 */

import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { ApiErrorBody, EventSummary, RsvpResponse } from "../../shared/api-types";
import {
  api,
  deleteRsvp,
  projectedCount,
  putRsvp,
  roomStub,
  rsvpCount,
  seedEvent,
  seedUser,
  seedUsers,
} from "../helpers";

async function memberCount(event: { id: string; roomKey: string }): Promise<number> {
  return runInDurableObject(roomStub(event), (_instance, state) => {
    const row = state.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM members").toArray()[0];
    return row?.n ?? 0;
  });
}

describe("an event seeded straight into D1", () => {
  it("shows as full on the board and refuses a new RSVP with 409", async () => {
    const seated = await seedUsers(4);
    const latecomer = await seedUser();
    const event = await seedEvent({ capacity: 4, rsvpPlayerIds: seated.map((player) => player.id) });

    const list = await api<EventSummary[]>("/api/events");
    expect(list.body.find((summary) => summary.id === event.id)).toMatchObject({ isFull: true, seatsLeft: 0 });

    const { status, body } = (await putRsvp(event.id, latecomer.id)) as { status: number; body: ApiErrorBody };
    expect(status).toBe(409);
    expect(body.error.code).toBe("EVENT_FULL");
    expect(await rsvpCount(event.id)).toBe(4);
  });

  it("recognises a seeded attendee as already confirmed, not as a new RSVP", async () => {
    const player = await seedUser();
    const event = await seedEvent({ capacity: 4, rsvpPlayerIds: [player.id] });

    const { status, body } = await putRsvp(event.id, player.id);

    expect(status).toBe(200);
    expect(body as RsvpResponse).toEqual({
      status: "already_confirmed",
      attendeeCount: 1,
      capacity: 4,
      seatsLeft: 3,
    });
    expect(await rsvpCount(event.id)).toBe(1); // no second row
  });

  it("frees a seat when a seeded attendee cancels from a cold room", async () => {
    const seated = await seedUsers(3);
    const waiting = await seedUser();
    const event = await seedEvent({ capacity: 3, rsvpPlayerIds: seated.map((player) => player.id) });

    // First call on this room is a cancel, so hydration happens on that path.
    const cancelled = await deleteRsvp(event.id, seated[0]!.id);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body as RsvpResponse).toEqual({
      status: "cancelled",
      attendeeCount: 2,
      capacity: 3,
      seatsLeft: 1,
    });

    const taken = await putRsvp(event.id, waiting.id);
    expect(taken.status).toBe(201);
    expect((taken.body as RsvpResponse).attendeeCount).toBe(3);

    expect(await rsvpCount(event.id)).toBe(3);
    expect(await projectedCount(event.id)).toBe(3);
    expect(await memberCount(event)).toBe(3);
  });

  it("hydrates exactly once even when the first N requests arrive together", async () => {
    // The mutex means the first caller hydrates and the rest see a warm room:
    // the outcome must be identical to the warm case, with no double-counting.
    const seated = await seedUsers(2);
    const newcomers = await seedUsers(10);
    const event = await seedEvent({ capacity: 4, rsvpPlayerIds: seated.map((player) => player.id) });

    const responses = await Promise.all(newcomers.map((person) => putRsvp(event.id, person.id)));
    const statuses = responses.map((response) => response.status);

    // 4 seats, 2 already taken → exactly 2 newcomers get in.
    expect(statuses.filter((status) => status === 201)).toHaveLength(2);
    expect(statuses.filter((status) => status === 409)).toHaveLength(8);

    expect(await rsvpCount(event.id)).toBe(4);
    expect(await projectedCount(event.id)).toBe(4);
    expect(await memberCount(event)).toBe(4);
  });

  it("handles a seeded attendee and newcomers racing on the same cold room", async () => {
    const seated = await seedUsers(1);
    const newcomers = await seedUsers(6);
    const event = await seedEvent({ capacity: 3, rsvpPlayerIds: seated.map((player) => player.id) });

    const responses = await Promise.all([
      // The seeded player retries; the room has never seen them.
      putRsvp(event.id, seated[0]!.id),
      ...newcomers.map((person) => putRsvp(event.id, person.id)),
    ]);

    // The seeded player must get 200 already_confirmed, never a 201 or a 409.
    expect(responses[0]!.status).toBe(200);
    expect((responses[0]!.body as RsvpResponse).status).toBe("already_confirmed");

    const newcomerStatuses = responses.slice(1).map((response) => response.status);
    expect(newcomerStatuses.filter((status) => status === 201)).toHaveLength(2);
    expect(newcomerStatuses.filter((status) => status === 409)).toHaveLength(4);

    expect(await rsvpCount(event.id)).toBe(3);
    expect(await memberCount(event)).toBe(3);
  });
});
