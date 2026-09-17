/**
 * `EventRoom` at the RPC level — the paths that are awkward to provoke through
 * HTTP because they need the room and D1 to be deliberately out of step.
 *
 * `runInDurableObject` is used only to *inspect* the room's private SQLite, so
 * the assertions are about real stored state and not about a mock.
 *
 * Note: the two tests that deliberately make an RPC call reject print
 * `uncaught exception; source = Uncaught (in promise)` to the test log. That is
 * the workerd/vitest-plugin RPC layer, not a leaked promise here — a one-line
 * DO method that does nothing but `throw` logs exactly the same thing. The
 * rejection *is* delivered to the caller, which is what these tests assert, and
 * which is what `worker/routes/rsvp.ts` turns into a 503.
 */

import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { addRsvpsDirectly, projectedCount, roomStub, rsvpCount, seedEvent, seedUser, seedUsers } from "../helpers";

/**
 * Awaits an RPC call into a *native* promise before vitest inspects it. The
 * stub returns a pipelining proxy, and letting `expect().rejects` poke at that
 * proxy spawns extra promises that reject with nobody listening.
 */
async function callRsvp(stub: ReturnType<typeof roomStub>, eventId: string, playerId: string): Promise<unknown> {
  return stub.rsvp(eventId, playerId);
}

interface RoomState {
  meta: { event_id: string; capacity: number; hydrated_at: string }[];
  members: string[];
}

async function readRoom(event: { id: string; roomKey: string }): Promise<RoomState> {
  return runInDurableObject(roomStub(event), (_instance, state) => ({
    meta: state.storage.sql
      .exec<{ event_id: string; capacity: number; hydrated_at: string }>("SELECT * FROM meta")
      .toArray(),
    members: state.storage.sql
      .exec<{ player_id: string }>("SELECT player_id FROM members ORDER BY created_at, player_id")
      .toArray()
      .map((row) => row.player_id),
  }));
}

describe("lazy hydration", () => {
  it("starts empty and builds meta + members from D1 on first use", async () => {
    const seated = await seedUsers(2);
    const newcomer = await seedUser();
    const event = await seedEvent({ capacity: 5, rsvpPlayerIds: seated.map((player) => player.id) });

    // Cold: the seed wrote to D1 only, so the room has never been touched.
    expect(await readRoom(event)).toEqual({ meta: [], members: [] });

    const outcome = await roomStub(event).rsvp(event.id, newcomer.id);
    expect(outcome).toEqual({ kind: "created", attendeeCount: 3, capacity: 5 });

    const room = await readRoom(event);
    expect(room.meta).toEqual([{ event_id: event.id, capacity: 5, hydrated_at: expect.any(String) as string }]);
    expect(room.members.sort()).toEqual([...seated.map((player) => player.id), newcomer.id].sort());
  });

  it("hydrates on cancel too, not only on rsvp", async () => {
    const [seated, other] = await seedUsers(2);
    const event = await seedEvent({ capacity: 3, rsvpPlayerIds: [seated!.id] });

    // Cancelling someone who is not attending still has to know who *is*.
    const outcome = await roomStub(event).cancel(event.id, other!.id);
    expect(outcome).toEqual({ kind: "not_attending", attendeeCount: 1, capacity: 3 });
    expect((await readRoom(event)).members).toEqual([seated!.id]);
  });

  it("reports a seeded-full event as full on its very first call", async () => {
    const seated = await seedUsers(3);
    const newcomer = await seedUser();
    const event = await seedEvent({ capacity: 3, rsvpPlayerIds: seated.map((player) => player.id) });

    expect(await roomStub(event).rsvp(event.id, newcomer.id)).toEqual({
      kind: "full",
      attendeeCount: 3,
      capacity: 3,
    });
    expect(await rsvpCount(event.id)).toBe(3);
  });

  it("propagates a failure when the event no longer exists in D1", async () => {
    const player = await seedUser();
    const event = await seedEvent();
    await roomStub(event).cancel(event.id, player.id); // hydrate, then destroy the row

    const ghost = { id: `evt_${crypto.randomUUID()}`, roomKey: crypto.randomUUID() };
    await expect(callRsvp(roomStub(ghost), ghost.id, player.id)).rejects.toThrow();
  });
});

describe("divergence between the room and D1", () => {
  it("resyncs and reports full when D1 filled up behind the room's back", async () => {
    const gatecrasher = await seedUser();
    const squatters = await seedUsers(2);
    const event = await seedEvent({ capacity: 2 });

    // Warm the room while the event is empty: members = [], capacity = 2.
    await roomStub(event).cancel(event.id, gatecrasher.id);
    expect(await readRoom(event)).toMatchObject({ members: [] });

    // Now fill D1 directly — the room still believes there are two free seats.
    await addRsvpsDirectly(
      event.id,
      squatters.map((player) => player.id),
    );

    // The room waves the request through its own check; the guarded insert in
    // D1 is what catches it (`changes === 0`), which triggers the resync.
    const outcome = await roomStub(event).rsvp(event.id, gatecrasher.id);
    expect(outcome).toEqual({ kind: "full", attendeeCount: 2, capacity: 2 });

    // The room healed itself from D1, and did not add the rejected player.
    const room = await readRoom(event);
    expect(room.members.sort()).toEqual(squatters.map((player) => player.id).sort());
    expect(room.members).not.toContain(gatecrasher.id);

    expect(await rsvpCount(event.id)).toBe(2);
    expect(await projectedCount(event.id)).toBe(2);
  });

  it("resyncs and reports already_confirmed when D1 already has the player", async () => {
    const player = await seedUser();
    const event = await seedEvent({ capacity: 4 });

    await roomStub(event).cancel(event.id, player.id); // warm the room, empty
    await addRsvpsDirectly(event.id, [player.id]); // …then add the player behind its back

    const outcome = await roomStub(event).rsvp(event.id, player.id);
    expect(outcome).toEqual({ kind: "already", attendeeCount: 1, capacity: 4 });

    expect((await readRoom(event)).members).toEqual([player.id]);
    expect(await rsvpCount(event.id)).toBe(1); // no duplicate row
  });

  it("recovers when the room's own storage is wiped", async () => {
    const player = await seedUser();
    const event = await seedEvent({ capacity: 2 });
    expect(await roomStub(event).rsvp(event.id, player.id)).toMatchObject({ kind: "created" });

    // Simulate storage loss: the room forgets everything it knew.
    await runInDurableObject(roomStub(event), (_instance, state) => {
      state.storage.sql.exec("DELETE FROM meta");
      state.storage.sql.exec("DELETE FROM members");
    });

    // The next call rehydrates from D1 and still refuses the duplicate.
    expect(await roomStub(event).rsvp(event.id, player.id)).toEqual({
      kind: "already",
      attendeeCount: 1,
      capacity: 2,
    });
    expect(await rsvpCount(event.id)).toBe(1);
  });

  it("gives an event a fresh, correct room when room_key is rotated", async () => {
    const player = await seedUser();
    const event = await seedEvent({ capacity: 2 });
    await roomStub(event).rsvp(event.id, player.id);

    // A rotated key names a different DO — cold, but D1 still holds the truth.
    const rotated = { id: event.id, roomKey: crypto.randomUUID() };
    expect(await roomStub(rotated).rsvp(rotated.id, player.id)).toEqual({
      kind: "already",
      attendeeCount: 1,
      capacity: 2,
    });
    expect(await rsvpCount(event.id)).toBe(1);
  });
});

describe("the mutex", () => {
  it("serialises concurrent RPC calls to one room", async () => {
    const people = await seedUsers(10);
    const event = await seedEvent({ capacity: 4 });
    const stub = roomStub(event);

    const outcomes = await Promise.all(people.map((person) => stub.rsvp(event.id, person.id)));

    expect(outcomes.filter((outcome) => outcome.kind === "created")).toHaveLength(4);
    expect(outcomes.filter((outcome) => outcome.kind === "full")).toHaveLength(6);
    expect(await rsvpCount(event.id)).toBe(4);
    expect((await readRoom(event)).members).toHaveLength(4);
  });

  it("does not wedge the room when a call fails", async () => {
    const player = await seedUser();
    const event = await seedEvent({ capacity: 2 });
    const stub = roomStub(event);

    // A call against an event id that is not in D1 rejects…
    const ghostId = `evt_${crypto.randomUUID()}`;
    await expect(callRsvp(stub, ghostId, player.id)).rejects.toThrow();

    // …and the very next call on the same room still works.
    expect(await stub.rsvp(event.id, player.id)).toMatchObject({ kind: "created" });
  });
});
