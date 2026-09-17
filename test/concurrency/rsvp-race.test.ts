/**
 * S1 — never over-book, even when everyone taps at once.
 *
 * These go through `SELF.fetch`, i.e. the real Worker, the real router, the
 * real `EVENT_ROOM` binding and the real local D1. Nothing is stubbed, so what
 * passes here is the same code path production runs.
 *
 * The assertion that matters is not "no more than `capacity` succeeded" — it is
 * the exact tally: precisely `capacity` 201s, precisely `players - capacity`
 * 409s, and no other status anywhere. A lost RSVP is as much a bug as a
 * duplicate one.
 */

import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { RsvpResponse } from "../../shared/api-types";
import { deleteRsvp, projectedCount, putRsvp, roomStub, rsvpCount, seedEvent, seedUsers } from "../helpers";

/** How many players the room thinks hold a seat. */
async function memberCount(event: { id: string; roomKey: string }): Promise<number> {
  return runInDurableObject(roomStub(event), (_instance, state) => {
    const row = state.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM members").toArray()[0];
    return row?.n ?? 0;
  });
}

function tally(statuses: number[]): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const status of statuses) counts[status] = (counts[status] ?? 0) + 1;
  return counts;
}

describe("concurrent RSVPs from distinct players", () => {
  it.each([
    { capacity: 1, players: 25 },
    { capacity: 5, players: 25 },
  ])("capacity $capacity, $players simultaneous players", async ({ capacity, players }) => {
    const people = await seedUsers(players);
    const event = await seedEvent({ capacity });

    // Fired together: every request is in flight before any of them resolves.
    const responses = await Promise.all(people.map((person) => putRsvp(event.id, person.id)));

    expect(tally(responses.map((response) => response.status))).toEqual({
      201: capacity,
      409: players - capacity,
    });

    // Every 409 is an honest "full", not a stray validation or auth failure.
    for (const response of responses) {
      if (response.status !== 409) continue;
      expect((response.body as { error: { code: string } }).error.code).toBe("EVENT_FULL");
    }

    // The three places a seat is recorded all agree.
    expect(await rsvpCount(event.id)).toBe(capacity);
    expect(await projectedCount(event.id)).toBe(capacity);
    expect(await memberCount(event)).toBe(capacity);

    // Every winner sees a consistent body.
    const winners = responses.filter((response) => response.status === 201);
    for (const winner of winners) {
      const body = winner.body as RsvpResponse;
      expect(body.status).toBe("confirmed");
      expect(body.capacity).toBe(capacity);
      expect(body.attendeeCount).toBeLessThanOrEqual(capacity);
      expect(body.seatsLeft).toBe(capacity - body.attendeeCount);
    }
  });

  it("re-opens exactly one seat when a winner cancels, and no more", async () => {
    const capacity = 3;
    const people = await seedUsers(12);
    const event = await seedEvent({ capacity });

    const first = await Promise.all(people.map((person) => putRsvp(event.id, person.id)));
    const winners = people.filter((_person, index) => first[index]?.status === 201);
    const losers = people.filter((_person, index) => first[index]?.status === 409);

    expect(winners).toHaveLength(capacity);

    // One winner drops out…
    expect((await deleteRsvp(event.id, winners[0]!.id)).status).toBe(200);
    expect(await rsvpCount(event.id)).toBe(capacity - 1);

    // …and every loser races for the single freed seat.
    const second = await Promise.all(losers.map((person) => putRsvp(event.id, person.id)));
    expect(tally(second.map((response) => response.status))).toEqual({
      201: 1,
      409: losers.length - 1,
    });

    expect(await rsvpCount(event.id)).toBe(capacity);
    expect(await projectedCount(event.id)).toBe(capacity);
    expect(await memberCount(event)).toBe(capacity);
  });

  it("keeps independent events independent", async () => {
    const people = await seedUsers(8);
    const [a, b] = await Promise.all([seedEvent({ capacity: 2 }), seedEvent({ capacity: 3 })]);

    const responses = await Promise.all([
      ...people.map((person) => putRsvp(a.id, person.id)),
      ...people.map((person) => putRsvp(b.id, person.id)),
    ]);

    expect(tally(responses.map((response) => response.status))).toEqual({ 201: 5, 409: 11 });
    expect(await rsvpCount(a.id)).toBe(2);
    expect(await rsvpCount(b.id)).toBe(3);
  });
});
