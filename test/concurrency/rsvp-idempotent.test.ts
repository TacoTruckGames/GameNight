/**
 * S2 — no duplicate RSVPs on retries.
 *
 * The realistic shape of this bug is not a double-click; it is a client that
 * sent a PUT, never saw the response, and sent it again — possibly while the
 * first one is still in flight. So every case here fires the *same* player's
 * requests simultaneously rather than one after another.
 */

import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { RsvpResponse } from "../../shared/api-types";
import { deleteRsvp, projectedCount, putRsvp, roomStub, rsvpCount, seedEvent, seedUser, seedUsers } from "../helpers";

function tally(statuses: number[]): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const status of statuses) counts[status] = (counts[status] ?? 0) + 1;
  return counts;
}

async function memberCount(event: { id: string; roomKey: string }): Promise<number> {
  return runInDurableObject(roomStub(event), (_instance, state) => {
    const row = state.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM members").toArray()[0];
    return row?.n ?? 0;
  });
}

describe("the same player retrying", () => {
  it("gets exactly one 201 out of 10 simultaneous PUTs, and one row", async () => {
    const player = await seedUser();
    const event = await seedEvent({ capacity: 4 });

    const responses = await Promise.all(Array.from({ length: 10 }, () => putRsvp(event.id, player.id)));
    const statuses = responses.map((response) => response.status);

    expect(tally(statuses)).toEqual({ 201: 1, 200: 9 });
    for (const response of responses) {
      const body = response.body as RsvpResponse;
      // Whichever one won, every caller is told the same thing: you are in.
      expect(["confirmed", "already_confirmed"]).toContain(body.status);
      expect(body.attendeeCount).toBe(1);
      expect(body.seatsLeft).toBe(3);
    }

    expect(await rsvpCount(event.id)).toBe(1);
    expect(await projectedCount(event.id)).toBe(1);
    expect(await memberCount(event)).toBe(1);
  });

  it("does not consume more than one seat on a capacity-1 event", async () => {
    const player = await seedUser();
    const event = await seedEvent({ capacity: 1 });

    const responses = await Promise.all(Array.from({ length: 10 }, () => putRsvp(event.id, player.id)));

    // Never a 409: the player who holds the seat is not competing with himself.
    expect(tally(responses.map((response) => response.status))).toEqual({ 201: 1, 200: 9 });
    expect(await rsvpCount(event.id)).toBe(1);
  });

  it("gets 10 x 200 from 10 simultaneous DELETEs and ends with no row", async () => {
    const player = await seedUser();
    const event = await seedEvent({ capacity: 4 });
    await putRsvp(event.id, player.id);

    const responses = await Promise.all(Array.from({ length: 10 }, () => deleteRsvp(event.id, player.id)));

    expect(tally(responses.map((response) => response.status))).toEqual({ 200: 10 });
    const statuses = responses.map((response) => (response.body as RsvpResponse).status);
    expect(statuses.filter((status) => status === "cancelled")).toHaveLength(1);
    expect(statuses.filter((status) => status === "not_attending")).toHaveLength(9);

    expect(await rsvpCount(event.id)).toBe(0);
    expect(await projectedCount(event.id)).toBe(0);
    expect(await memberCount(event)).toBe(0);
  });

  it("survives a mixed PUT/DELETE storm with a consistent, in-bounds count", async () => {
    const capacity = 3;
    const people = await seedUsers(6);
    const event = await seedEvent({ capacity });

    // 60 overlapping writes: every player alternately claims and drops a seat.
    const requests = Array.from({ length: 60 }, (_value, index) => {
      const person = people[index % people.length]!;
      return index % 2 === 0 ? putRsvp(event.id, person.id) : deleteRsvp(event.id, person.id);
    });
    const responses = await Promise.all(requests);

    // Nothing blew up: every response is one of the four documented outcomes.
    for (const response of responses) {
      expect([200, 201, 409]).toContain(response.status);
    }

    const rows = await rsvpCount(event.id);
    const projected = await projectedCount(event.id);

    // The invariants that must hold no matter how the storm interleaved.
    expect(projected).toBe(rows); // the projection never drifts from the rows
    expect(rows).toBeLessThanOrEqual(capacity); // S1 held throughout
    expect(rows).toBeGreaterThanOrEqual(0);
    expect(await memberCount(event)).toBe(rows); // the room agrees with D1

    // And the board reports the same thing the database holds.
    const detail = await putRsvp(event.id, (await seedUser()).id);
    expect([201, 409]).toContain(detail.status);
  });
});
