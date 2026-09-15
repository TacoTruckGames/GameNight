/**
 * Every D1 statement the request path issues, in one file.
 *
 * Two rules hold throughout:
 *
 * 1. **No `COUNT(*)` on a read path.** Attendee counts come from
 *    `events.rsvp_count`, a write-through projection that the RSVP batch
 *    recomputes from the `rsvps` rows in the same atomic statement list (see
 *    `worker/do/EventRoom.ts`). Reads are therefore O(1) per row and exact.
 * 2. **`LIKE` patterns are escaped.** `%` and `_` in user input are literals,
 *    not wildcards, so a search for `100%` cannot turn into a full scan match.
 */

import { isGameType } from "../../shared/game-types";
import type { Attendee, EventSummary, Role, User } from "../../shared/api-types";
import type { GameType } from "../../shared/game-types";

// ------------------------------------------------------------------- rows --

/** A full `events` row plus the organizer's display name. */
export interface EventRow {
  id: string;
  organizer_id: string;
  title: string;
  game_type: string;
  starts_at: string;
  location: string;
  capacity: number;
  rsvp_count: number;
  room_key: string;
  organizer_name: string;
}

const EVENT_COLUMNS = `e.id, e.organizer_id, e.title, e.game_type, e.starts_at, e.location,
         e.capacity, e.rsvp_count, e.room_key, u.name AS organizer_name`;

/**
 * `game_type` is validated by zod before it is ever written, so this only has
 * to survive hand-edited rows; an unrecognised value degrades to `other`
 * instead of breaking the client's label lookup.
 */
function toGameType(value: string): GameType {
  return isGameType(value) ? value : "other";
}

/** Row → wire shape. `seatsLeft`/`isFull` are derived here so no client re-does it. */
export function toEventSummary(row: EventRow): EventSummary {
  return {
    id: row.id,
    title: row.title,
    gameType: toGameType(row.game_type),
    startsAt: row.starts_at,
    location: row.location,
    capacity: row.capacity,
    attendeeCount: row.rsvp_count,
    seatsLeft: Math.max(0, row.capacity - row.rsvp_count),
    isFull: row.rsvp_count >= row.capacity,
    organizerName: row.organizer_name,
  };
}

// ------------------------------------------------------------------ users --

export async function listUsers(db: D1Database): Promise<User[]> {
  const { results } = await db
    .prepare("SELECT id, name, role FROM users ORDER BY role, name COLLATE NOCASE, id")
    .all<{ id: string; name: string; role: string }>();
  return results.map((row) => ({ id: row.id, name: row.name, role: row.role as Role }));
}

export async function insertUser(db: D1Database, id: string, name: string, role: Role): Promise<User> {
  await db.prepare("INSERT INTO users (id, name, role) VALUES (?1, ?2, ?3)").bind(id, name, role).run();
  return { id, name, role };
}

// ----------------------------------------------------------------- events --

/**
 * Escape `LIKE`'s wildcards so user input is matched literally. Paired with
 * `ESCAPE '\'` in the SQL below.
 */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export interface EventFilters {
  /** ISO-8601 UTC; events starting before this are "past" and excluded. */
  now: string;
  q?: string | undefined;
  gameType?: GameType | undefined;
}

/** Upcoming events, soonest first. `LIMIT 200` — no pagination at this scale. */
export async function listUpcomingEvents(db: D1Database, filters: EventFilters): Promise<EventSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT ${EVENT_COLUMNS}
         FROM events e
         JOIN users u ON u.id = e.organizer_id
        WHERE e.starts_at >= ?1
          AND (?2 IS NULL OR e.game_type = ?2)
          AND (?3 IS NULL OR e.title LIKE ?3 ESCAPE '\\' OR e.location LIKE ?3 ESCAPE '\\')
        ORDER BY e.starts_at, e.id
        LIMIT 200`,
    )
    .bind(filters.now, filters.gameType ?? null, filters.q === undefined ? null : likePattern(filters.q))
    .all<EventRow>();
  return results.map(toEventSummary);
}

export function getEventRow(db: D1Database, id: string): Promise<EventRow | null> {
  return db
    .prepare(
      `SELECT ${EVENT_COLUMNS}
         FROM events e
         JOIN users u ON u.id = e.organizer_id
        WHERE e.id = ?1`,
    )
    .bind(id)
    .first<EventRow>();
}

export interface NewEvent {
  id: string;
  organizerId: string;
  title: string;
  gameType: GameType;
  startsAt: string;
  location: string;
  capacity: number;
  roomKey: string;
}

export async function insertEvent(db: D1Database, event: NewEvent): Promise<void> {
  await db
    .prepare(
      `INSERT INTO events (id, organizer_id, title, game_type, starts_at, location, capacity, rsvp_count, room_key)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8)`,
    )
    .bind(
      event.id,
      event.organizerId,
      event.title,
      event.gameType,
      event.startsAt,
      event.location,
      event.capacity,
      event.roomKey,
    )
    .run();
}

/** Attendees in RSVP order — the order the organizer's sheet should read in. */
export async function listAttendees(db: D1Database, eventId: string): Promise<Attendee[]> {
  const { results } = await db
    .prepare(
      `SELECT r.player_id, u.name, r.created_at
         FROM rsvps r
         JOIN users u ON u.id = r.player_id
        WHERE r.event_id = ?1
        ORDER BY r.created_at, r.player_id`,
    )
    .bind(eventId)
    .all<{ player_id: string; name: string; created_at: string }>();
  return results.map((row) => ({ playerId: row.player_id, name: row.name, rsvpAt: row.created_at }));
}

// ------------------------------------------------------------------ rsvps --

/** Primary-key lookup, not a count. */
export async function hasRsvp(db: D1Database, eventId: string, playerId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS present FROM rsvps WHERE event_id = ?1 AND player_id = ?2")
    .bind(eventId, playerId)
    .first<{ present: number }>();
  return row !== null;
}

/** The player's upcoming events, soonest first. */
export async function listPlayerRsvps(db: D1Database, playerId: string, now: string): Promise<EventSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT ${EVENT_COLUMNS}
         FROM rsvps r
         JOIN events e ON e.id = r.event_id
         JOIN users u ON u.id = e.organizer_id
        WHERE r.player_id = ?1 AND e.starts_at >= ?2
        ORDER BY e.starts_at, e.id
        LIMIT 200`,
    )
    .bind(playerId, now)
    .all<EventRow>();
  return results.map(toEventSummary);
}

/** The organizer's own upcoming events, soonest first. */
export async function listHostedEvents(db: D1Database, organizerId: string, now: string): Promise<EventSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT ${EVENT_COLUMNS}
         FROM events e
         JOIN users u ON u.id = e.organizer_id
        WHERE e.organizer_id = ?1 AND e.starts_at >= ?2
        ORDER BY e.starts_at, e.id
        LIMIT 200`,
    )
    .bind(organizerId, now)
    .all<EventRow>();
  return results.map(toEventSummary);
}
