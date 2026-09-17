/**
 * Addressing an event's `EventRoom`.
 *
 * The room name is `${eventId}:${room_key}`, never the bare event id. That one
 * indirection is what makes "give this event a fresh, empty room" a single
 * column update: a new `room_key` names a Durable Object that has never existed,
 * so it hydrates itself from D1 on first use (see `EventRoom.ensureHydrated`).
 *
 * Three callers need it — the RSVP route, and the two edit routes (the admin's
 * and the organizer's), which rotate the key whenever capacity changes so a
 * hydrated room cannot keep answering "full" from a stale cached capacity.
 */

import type { EventRoom } from "../do/EventRoom";

/** The minimum an event row has to carry to be addressable. */
export interface RoomAddress {
  id: string;
  room_key: string;
}

export function roomFor(env: Env, event: RoomAddress): DurableObjectStub<EventRoom> {
  return env.EVENT_ROOM.get(env.EVENT_ROOM.idFromName(`${event.id}:${event.room_key}`));
}

/**
 * A fresh salt: 16 hex characters from the CSPRNG. Same shape as the one
 * `POST /api/events` mints, so nothing downstream can tell a rotated key from
 * an original one.
 */
export function newRoomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
