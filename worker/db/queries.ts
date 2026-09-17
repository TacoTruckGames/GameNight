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

import { DEFAULT_EVENT_SORT, type EventSort } from "../../shared/event-sort";
import { isGameType } from "../../shared/game-types";
import type {
  AdminEvent,
  AdminOverview,
  AdminUser,
  Attendee,
  AuditAction,
  AuditEntry,
  DayCount,
  ErrorEntry,
  EventPlace,
  EventStatus,
  EventSummary,
  Page,
  Role,
  User,
} from "../../shared/api-types";
import type { GameType } from "../../shared/game-types";
import { ADMIN_PAGE_SIZE, type EventPatch, type AdminEventsQuery, type AdminUsersQuery } from "../../shared/schemas";

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
  status: string;
  organizer_name: string;
  /** Null when the organizer wrote none. Never `''` — see `createEventSchema`. */
  description: string | null;
  // The verified-venue half. All four, or none — see `toPlace`. `place_resolved_at`
  // is deliberately not selected: it is operational metadata, not wire data.
  place_id: string | null;
  place_address: string | null;
  place_lat: number | null;
  place_lng: number | null;
}

const EVENT_COLUMNS = `e.id, e.organizer_id, e.title, e.game_type, e.starts_at, e.location,
         e.capacity, e.rsvp_count, e.room_key, e.status, e.description,
         e.place_id, e.place_address, e.place_lat, e.place_lng,
         u.name AS organizer_name`;

/**
 * `game_type` is validated by zod before it is ever written, so this only has
 * to survive hand-edited rows; an unrecognised value degrades to `other`
 * instead of breaking the client's label lookup.
 */
function toGameType(value: string): GameType {
  return isGameType(value) ? value : "other";
}

/**
 * All four columns, or no place at all.
 *
 * SQLite cannot express "these are set together" as a CHECK added by ALTER, so
 * the invariant lives here, in the one mapper every read path goes through. The
 * failure it prevents is specific: a row with an address but a null latitude
 * would otherwise render as a map pin at 0,0 — a spot in the Gulf of Guinea —
 * which is a far worse answer than "this event has no verified venue".
 */
function toPlace(row: EventRow): EventPlace | null {
  const { place_id: id, place_address: address, place_lat: lat, place_lng: lng } = row;
  if (id == null || address == null || lat == null || lng == null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { id, address, lat, lng };
}

/**
 * Row → wire shape. `seatsLeft`/`isFull` are derived here so no client re-does it.
 *
 * `description` is deliberately *not* emitted: this is the list mapper, and the
 * list stays lean (see `EventSummary`). The two detail routes add it from the
 * row themselves, which is the only place it is ever sent.
 */
export function toEventSummary(row: EventRow): EventSummary {
  return {
    id: row.id,
    title: row.title,
    gameType: toGameType(row.game_type),
    startsAt: row.starts_at,
    location: row.location,
    place: toPlace(row),
    capacity: row.capacity,
    attendeeCount: row.rsvp_count,
    seatsLeft: Math.max(0, row.capacity - row.rsvp_count),
    isFull: row.rsvp_count >= row.capacity,
    // Same defensive degrade as `game_type`: an unrecognised value reads as the
    // safe default rather than breaking the card.
    status: row.status === "cancelled" ? "cancelled" : "scheduled",
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

/**
 * When a list is asking about. Shared by the board and the two personal lists,
 * which all answer the same two questions in the same two ways.
 */
export interface TimeFilters {
  /** ISO-8601 UTC. Used only when there is no window: events before it are "past" and excluded. */
  now: string;
  /**
   * The optional date window, half-open: `from` inclusive, `to` exclusive, both
   * ISO-8601 UTC in the storage format. Both or neither — a lone half is a
   * caller bug the schema rejects before it gets here, and is ignored below.
   */
  from?: string | undefined;
  to?: string | undefined;
}

export interface EventFilters extends TimeFilters {
  q?: string | undefined;
  gameType?: GameType | undefined;
  sort?: EventSort | undefined;
}

/**
 * The two bound values every one of these queries needs: the lower bound it
 * compares `starts_at >=` against, and the upper bound (or NULL, meaning "no
 * upper bound") it compares `<` against.
 *
 * Both or neither: a half-specified window falls back to upcoming-only rather
 * than inventing the end the caller did not send.
 */
function timeBounds(filters: TimeFilters): { start: string; end: string | null } {
  const { now, from, to } = filters;
  return from !== undefined && to !== undefined ? { start: from, end: to } : { start: now, end: null };
}

/**
 * The board's two orderings. Interpolated, never bound: SQLite cannot
 * parameterise `ORDER BY`, so this is a lookup on a zod-validated enum and the
 * only two strings that can reach the query are the two written here.
 *
 * `popular` reads as: joinable tables first (a full one cannot be RSVP'd to,
 * so it sinks), then fullest-first by ratio rather than by raw head count — a
 * 7-of-8 table is hotter than a 10-of-40 one — then soonest, then `id` so the
 * order is total and the list is stable between refreshes.
 *
 * `capacity` is `CHECK (capacity BETWEEN 1 AND 500)`, so the division is safe.
 */
const ORDER_BY: Record<EventSort, string> = {
  date: "e.starts_at, e.id",
  popular: "(e.rsvp_count >= e.capacity), CAST(e.rsvp_count AS REAL) / e.capacity DESC, e.starts_at, e.id",
};

/**
 * The board's events, soonest first by default. `LIMIT 200` — no pagination at
 * this scale.
 *
 * Two modes, one query. Without a window this is the upcoming board: everything
 * from `now` on, with no upper bound. With one (`from`/`to`, half-open) `now`
 * stops applying and the span is whatever the caller asked for, past included —
 * which is what the calendar's month grid needs to put counts on the days
 * behind today. `?4` being NULL is what tells the two apart, in the same shape
 * as the optional filters below it.
 *
 * A window rather than an "include past" flag: past-inclusive with
 * `ORDER BY starts_at` would return oldest-first and could exhaust the 200 rows
 * before reaching anything still joinable. A window is bounded by construction.
 *
 * Cancelled events drop off the public board entirely, in both modes; the
 * people who already hold a seat still see them (with the status) via
 * `listPlayerRsvps`.
 */
export async function listEvents(db: D1Database, filters: EventFilters): Promise<EventSummary[]> {
  const { start, end } = timeBounds(filters);

  const { results } = await db
    .prepare(
      `SELECT ${EVENT_COLUMNS}
         FROM events e
         JOIN users u ON u.id = e.organizer_id
        WHERE e.starts_at >= ?1
          AND (?4 IS NULL OR e.starts_at < ?4)
          AND e.status = 'scheduled'
          AND (?2 IS NULL OR e.game_type = ?2)
          AND (?3 IS NULL OR e.title LIKE ?3 ESCAPE '\\' OR e.location LIKE ?3 ESCAPE '\\'
               -- The same bound parameter: searching "Pike" finds the event whose
               -- typed label says "back room" but whose verified address is on Pike St.
               OR e.place_address LIKE ?3 ESCAPE '\\')
        ORDER BY ${ORDER_BY[filters.sort ?? DEFAULT_EVENT_SORT]}
        LIMIT 200`,
    )
    .bind(start, filters.gameType ?? null, filters.q === undefined ? null : likePattern(filters.q), end)
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
  /** Absent, `null` and `''` all store NULL — the schema normalises before we get here. */
  description?: string | null;
  /**
   * Resolved server-side from a place id the client sent, or `null` — which is
   * both "the organizer typed free text" and "Google was unreachable". Creating
   * an event never fails over a venue lookup.
   */
  place?: ResolvedPlace | null;
}

/** A place plus the moment we resolved it. Mirrors `worker/lib/places.ts`. */
export interface ResolvedPlace extends EventPlace {
  resolvedAt: string;
}

export async function insertEvent(db: D1Database, event: NewEvent): Promise<void> {
  const place = event.place ?? null;
  // The column holds prose or NULL, never `''`. The schema already normalises a
  // blank textarea away; this is the braces to that belt, so the invariant holds
  // for any caller, not only the route.
  const description = event.description === "" ? null : (event.description ?? null);
  await db
    .prepare(
      `INSERT INTO events (id, organizer_id, title, game_type, starts_at, location, description,
                           capacity, rsvp_count, room_key,
                           place_id, place_address, place_lat, place_lng, place_resolved_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9, ?10, ?11, ?12, ?13, ?14)`,
    )
    .bind(
      event.id,
      event.organizerId,
      event.title,
      event.gameType,
      event.startsAt,
      event.location,
      description,
      event.capacity,
      event.roomKey,
      place?.id ?? null,
      place?.address ?? null,
      place?.lat ?? null,
      place?.lng ?? null,
      place?.resolvedAt ?? null,
    )
    .run();
}

/**
 * Just enough of an event to render its map: the coordinates and the id the
 * `?v=` cache buster has to match. Deliberately not `getEventRow` — the map
 * route is the hottest cache-miss path in the app and has no use for a join.
 */
export function getEventPlace(
  db: D1Database,
  id: string,
): Promise<{ place_id: string | null; place_lat: number | null; place_lng: number | null } | null> {
  return db
    .prepare("SELECT place_id, place_lat, place_lng FROM events WHERE id = ?1")
    .bind(id)
    .first<{ place_id: string | null; place_lat: number | null; place_lng: number | null }>();
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

/**
 * The player's seats, soonest first — upcoming only, or a given week when the
 * agenda sends a window, exactly as `listEvents`.
 *
 * Deliberately *not* filtered by status: someone holding a seat on an event an
 * admin called off needs to be told, so the cancelled row stays in the list and
 * the client renders it as cancelled. That holds in both modes — paging back a
 * week should not quietly rewrite what happened to a night you had booked.
 */
export async function listPlayerRsvps(
  db: D1Database,
  playerId: string,
  filters: TimeFilters,
): Promise<EventSummary[]> {
  const { start, end } = timeBounds(filters);
  const { results } = await db
    .prepare(
      `SELECT ${EVENT_COLUMNS}
         FROM rsvps r
         JOIN events e ON e.id = r.event_id
         JOIN users u ON u.id = e.organizer_id
        WHERE r.player_id = ?1 AND e.starts_at >= ?2
          AND (?3 IS NULL OR e.starts_at < ?3)
        ORDER BY e.starts_at, e.id
        LIMIT 200`,
    )
    .bind(playerId, start, end)
    .all<EventRow>();
  return results.map(toEventSummary);
}

/**
 * The organizer's own events, soonest first — cancelled ones included, and
 * upcoming-only unless the caller sends a window.
 */
export async function listHostedEvents(
  db: D1Database,
  organizerId: string,
  filters: TimeFilters,
): Promise<EventSummary[]> {
  const { start, end } = timeBounds(filters);
  const { results } = await db
    .prepare(
      `SELECT ${EVENT_COLUMNS}
         FROM events e
         JOIN users u ON u.id = e.organizer_id
        WHERE e.organizer_id = ?1 AND e.starts_at >= ?2
          AND (?3 IS NULL OR e.starts_at < ?3)
        ORDER BY e.starts_at, e.id
        LIMIT 200`,
    )
    .bind(organizerId, start, end)
    .all<EventRow>();
  return results.map(toEventSummary);
}

// ------------------------------------------------------------------ admin --
//
// One rule bends here, on purpose: the admin queries *do* use `COUNT(*)`
// subqueries (a user's RSVP and hosted totals, the overview tiles). Rule 1 at
// the top of this file is about the hot read path — the board, which every
// visitor loads. The admin surface is one operator, occasionally, over a table
// measured in hundreds of rows; a correct number beats another projection
// column to keep honest.

/** `LIMIT pageSize + 1`: the extra row is the only thing `hasNext` needs. */
function paginate<T>(rows: T[], page: number): Page<T> {
  const hasNext = rows.length > ADMIN_PAGE_SIZE;
  return {
    items: hasNext ? rows.slice(0, ADMIN_PAGE_SIZE) : rows,
    page,
    pageSize: ADMIN_PAGE_SIZE,
    hasNext,
  };
}

function pageBounds(page: number | undefined): { page: number; limit: number; offset: number } {
  const current = page ?? 1;
  return { page: current, limit: ADMIN_PAGE_SIZE + 1, offset: (current - 1) * ADMIN_PAGE_SIZE };
}

/** `metadata` columns are JSON text; a hand-edited row must not 500 the page. */
function parseMetadata(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ admin: users --

interface AdminUserRow {
  id: string;
  name: string;
  role: string;
  created_at: string;
  suspended_at: string | null;
  suspended_reason: string | null;
  rsvp_count: number;
  hosted_count: number;
}

const ADMIN_USER_COLUMNS = `u.id, u.name, u.role, u.created_at, u.suspended_at, u.suspended_reason,
         (SELECT COUNT(*) FROM rsvps r WHERE r.player_id = u.id) AS rsvp_count,
         (SELECT COUNT(*) FROM events ev WHERE ev.organizer_id = u.id) AS hosted_count`;

function toAdminUser(row: AdminUserRow): AdminUser {
  return {
    id: row.id,
    name: row.name,
    role: row.role as Role,
    createdAt: row.created_at,
    suspendedAt: row.suspended_at,
    suspendedReason: row.suspended_reason,
    rsvpCount: row.rsvp_count,
    hostedCount: row.hosted_count,
  };
}

/** Newest first. `q` matches the display name; `status` is the suspension flag. */
export async function adminListUsers(db: D1Database, filters: AdminUsersQuery): Promise<Page<AdminUser>> {
  const { page, limit, offset } = pageBounds(filters.page);
  const { results } = await db
    .prepare(
      `SELECT ${ADMIN_USER_COLUMNS}
         FROM users u
        WHERE (?1 IS NULL OR u.name LIKE ?1 ESCAPE '\\')
          AND (?2 IS NULL OR u.role = ?2)
          AND (?3 IS NULL
               OR (?3 = 'suspended' AND u.suspended_at IS NOT NULL)
               OR (?3 = 'active' AND u.suspended_at IS NULL))
        ORDER BY u.created_at DESC, u.id DESC
        LIMIT ?4 OFFSET ?5`,
    )
    .bind(
      filters.q === undefined ? null : likePattern(filters.q),
      filters.role ?? null,
      filters.status ?? null,
      limit,
      offset,
    )
    .all<AdminUserRow>();
  return paginate(results.map(toAdminUser), page);
}

/** The admin view of one user — also what the suspend/unsuspend routes return. */
export async function adminGetUser(db: D1Database, id: string): Promise<AdminUser | null> {
  const row = await db
    .prepare(`SELECT ${ADMIN_USER_COLUMNS} FROM users u WHERE u.id = ?1`)
    .bind(id)
    .first<AdminUserRow>();
  return row ? toAdminUser(row) : null;
}

/**
 * Suspend (`reason` may be `null` for "no reason given") or lift a suspension
 * (`suspended = false`). Idempotent: re-suspending only refreshes the reason.
 */
export async function adminSetSuspended(
  db: D1Database,
  id: string,
  suspended: boolean,
  reason: string | null,
  now: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE users
          SET suspended_at = ?2,
              suspended_reason = ?3
        WHERE id = ?1`,
    )
    .bind(id, suspended ? now : null, suspended ? reason : null)
    .run();
}

// ----------------------------------------------------------- admin: events --

export interface AdminEventRow extends EventRow {
  created_at: string;
  cancelled_at: string | null;
}

const ADMIN_EVENT_COLUMNS = `${EVENT_COLUMNS}, e.created_at, e.cancelled_at`;

/** Exported for the detail route, which pairs it with the row's `description`. */
export function toAdminEvent(row: AdminEventRow): AdminEvent {
  return {
    ...toEventSummary(row),
    organizerId: row.organizer_id,
    createdAt: row.created_at,
    cancelledAt: row.cancelled_at,
  };
}

/**
 * `when` defaults to `upcoming`. Cancelled events are included unless `status`
 * says otherwise — hiding them from the admin is exactly backwards.
 *
 * `ORDER BY` cannot be bound, so the two orderings are literals picked here:
 * upcoming reads soonest-first (what is about to happen), everything else
 * newest-first (what just happened).
 */
export async function adminListEvents(
  db: D1Database,
  filters: AdminEventsQuery & { now: string },
): Promise<Page<AdminEvent>> {
  const { page, limit, offset } = pageBounds(filters.page);
  const when = filters.when ?? "upcoming";
  const order = when === "upcoming" ? "e.starts_at ASC, e.id ASC" : "e.starts_at DESC, e.id DESC";

  const { results } = await db
    .prepare(
      `SELECT ${ADMIN_EVENT_COLUMNS}
         FROM events e
         JOIN users u ON u.id = e.organizer_id
        WHERE (?1 IS NULL OR e.title LIKE ?1 ESCAPE '\\' OR e.location LIKE ?1 ESCAPE '\\'
               OR e.place_address LIKE ?1 ESCAPE '\\')
          AND (?2 IS NULL OR e.status = ?2)
          AND (?3 = 'all'
               OR (?3 = 'upcoming' AND e.starts_at >= ?4)
               OR (?3 = 'past' AND e.starts_at < ?4))
        ORDER BY ${order}
        LIMIT ?5 OFFSET ?6`,
    )
    .bind(
      filters.q === undefined ? null : likePattern(filters.q),
      filters.status ?? null,
      when,
      filters.now,
      limit,
      offset,
    )
    .all<AdminEventRow>();
  return paginate(results.map(toAdminEvent), page);
}

export async function adminGetEvent(db: D1Database, id: string): Promise<AdminEvent | null> {
  const row = await adminGetEventRow(db, id);
  return row ? toAdminEvent(row) : null;
}

/** The raw row, for the route that needs `rsvp_count` and `room_key` too. */
export function adminGetEventRow(db: D1Database, id: string): Promise<AdminEventRow | null> {
  return db
    .prepare(
      `SELECT ${ADMIN_EVENT_COLUMNS}
         FROM events e
         JOIN users u ON u.id = e.organizer_id
        WHERE e.id = ?1`,
    )
    .bind(id)
    .first<AdminEventRow>();
}

/**
 * Re-point a venue, or unlink it. Never derived from `patch.placeId` inside
 * this function: resolving an id is a network call, and `queries.ts` does not
 * make network calls.
 */
export type PlaceUpdate = { kind: "clear" } | { kind: "set"; place: ResolvedPlace };

/**
 * Apply a partial edit. Only the fields present in `patch` are written, and the
 * returned list is what the audit row records as `changed`.
 *
 * `rotateRoom` sets a new `room_key` **in the same statement** as the capacity
 * change. That is hazard 1: `EventRoom` caches capacity in its own storage and
 * answers "full" from the cache without touching D1, so raising capacity on a
 * live event would otherwise be invisible until the room happened to rehydrate.
 * A new key names a room that has never existed, which hydrates from D1 — the
 * new capacity — on its next call.
 */
export async function updateEvent(
  db: D1Database,
  id: string,
  patch: EventPatch,
  rotateRoom: string | null,
  place: PlaceUpdate | null = null,
): Promise<string[]> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const changed: string[] = [];

  const write = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = ?${values.length + 1}`); // ?1 is the id
  };

  const assign = (field: string, column: string, value: unknown) => {
    if (value === undefined) return;
    write(column, value);
    changed.push(field);
  };

  assign("title", "title", patch.title);
  assign("gameType", "game_type", patch.gameType);
  assign("startsAt", "starts_at", patch.startsAt);
  assign("location", "location", patch.location);
  assign("capacity", "capacity", patch.capacity);
  // `assign` skips only `undefined`, so an explicit `null` writes NULL — which
  // is exactly how an admin clears a description, the same convention `placeId`
  // uses to unlink a venue. A blank textarea normalises to `undefined` in the
  // schema and therefore means "no change", not "erase it".
  assign("description", "description", patch.description);

  // Five columns, but **one** audit entry. `place` is a separate parameter
  // rather than five more `assign` calls precisely so that `changed` stays a
  // list of things a human changed — an operator reading the audit trail wants
  // to see "placeId", not "placeId, placeAddress, placeLat, placeLng,
  // placeResolvedAt" for one click on one field.
  if (place !== null) {
    const next = place.kind === "clear" ? null : place.place;
    write("place_id", next?.id ?? null);
    write("place_address", next?.address ?? null);
    write("place_lat", next?.lat ?? null);
    write("place_lng", next?.lng ?? null);
    write("place_resolved_at", next?.resolvedAt ?? null);
    changed.push("placeId");
  }

  if (rotateRoom !== null) {
    values.push(rotateRoom);
    sets.push(`room_key = ?${values.length + 1}`);
  }

  if (sets.length > 0) {
    await db
      .prepare(`UPDATE events SET ${sets.join(", ")} WHERE id = ?1`)
      .bind(id, ...values)
      .run();
  }
  return changed;
}

/** Cancel or restore. `cancelled_at` is cleared on restore so it never lies. */
export async function setEventStatus(
  db: D1Database,
  id: string,
  status: EventStatus,
  now: string,
): Promise<void> {
  await db
    .prepare("UPDATE events SET status = ?2, cancelled_at = ?3 WHERE id = ?1")
    .bind(id, status, status === "cancelled" ? now : null)
    .run();
}

/**
 * Gone, not cancelled — and only ever for an event nobody holds a seat on.
 *
 * The product's rule is that cancelling is a status change, never a delete: the
 * RSVP rows stay so the people who were coming still see the event, marked
 * cancelled, in their list. A delete is compatible with that rule exactly when
 * there are no such people, which is what the caller checks before calling
 * this. `rsvps.event_id` references `events(id)` without a cascade, so a delete
 * with seats outstanding would fail at the database anyway — the route turns
 * that into a 409 with a sentence rather than an opaque 500.
 */
export async function deleteEvent(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM events WHERE id = ?1").bind(id).run();
}

// ----------------------------------------------------------- admin: errors --

interface ErrorRow {
  id: string;
  fingerprint: string;
  scope: string;
  message: string;
  stack: string | null;
  metadata: string | null;
  count: number;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
}

function toErrorEntry(row: ErrorRow): ErrorEntry {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    scope: row.scope,
    message: row.message,
    stack: row.stack,
    metadata: parseMetadata(row.metadata),
    count: row.count,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    resolvedAt: row.resolved_at,
  };
}

/** Most recently seen first. `LIMIT 200` — the log is a triage list, not an archive. */
export async function listErrors(db: D1Database, status: "open" | "resolved" | "all"): Promise<ErrorEntry[]> {
  const { results } = await db
    .prepare(
      `SELECT id, fingerprint, scope, message, stack, metadata, count,
              first_seen_at, last_seen_at, resolved_at
         FROM error_log
        WHERE (?1 = 'all'
               OR (?1 = 'open' AND resolved_at IS NULL)
               OR (?1 = 'resolved' AND resolved_at IS NOT NULL))
        ORDER BY last_seen_at DESC, rowid DESC
        LIMIT 200`,
    )
    .bind(status)
    .all<ErrorRow>();
  return results.map(toErrorEntry);
}

/** Existence check for the resolve/dismiss routes, which 404 on an unknown id. */
export function getError(db: D1Database, id: string): Promise<{ id: string; fingerprint: string } | null> {
  return db
    .prepare("SELECT id, fingerprint FROM error_log WHERE id = ?1")
    .bind(id)
    .first<{ id: string; fingerprint: string }>();
}

/** Marks it handled. A later recurrence clears this again — see `reportError`. */
export async function resolveError(db: D1Database, id: string, now: string): Promise<void> {
  await db.prepare("UPDATE error_log SET resolved_at = ?2 WHERE id = ?1").bind(id, now).run();
}

export async function deleteError(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM error_log WHERE id = ?1").bind(id).run();
}

// ------------------------------------------------------------ admin: audit --

interface AuditRow {
  id: string;
  actor_id: string;
  actor_name: string | null;
  action: string;
  target_type: string;
  target_id: string;
  metadata: string | null;
  created_at: string;
}

function toAuditEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    actorId: row.actor_id,
    // The join is a LEFT JOIN so a row survives the actor being deleted; the
    // audit trail outliving its subject is the whole point of an audit trail.
    actorName: row.actor_name ?? row.actor_id,
    action: row.action as AuditAction,
    targetType: row.target_type as AuditEntry["targetType"],
    targetId: row.target_id,
    metadata: parseMetadata(row.metadata),
    createdAt: row.created_at,
  };
}

export async function listAudit(db: D1Database, limit: number): Promise<AuditEntry[]> {
  const { results } = await db
    .prepare(
      // `created_at` has second precision, so a burst of actions ties. `rowid`
      // is SQLite's insertion order — the exact tiebreak "newest first" means.
      `SELECT a.id, a.actor_id, u.name AS actor_name, a.action, a.target_type,
              a.target_id, a.metadata, a.created_at
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.actor_id
        ORDER BY a.created_at DESC, a.rowid DESC
        LIMIT ?1`,
    )
    .bind(limit)
    .all<AuditRow>();
  return results.map(toAuditEntry);
}

// --------------------------------------------------------- admin: overview --

interface DayRow {
  day: string;
  n: number;
}

/**
 * Zero-fill: SQL only returns the days that happened, and a bar chart with
 * holes in it is a lie. 14 entries, oldest first, ending on `now`'s UTC day.
 */
function densify(rows: DayRow[], now: Date, days: number): DayCount[] {
  const counts = new Map(rows.map((row) => [row.day, row.n]));
  const out: DayCount[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(now.getTime() - offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    out.push({ day, count: counts.get(day) ?? 0 });
  }
  return out;
}

const OVERVIEW_DAYS = 14;

function isoAgo(now: Date, hours: number): string {
  return `${new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString().slice(0, 19)}Z`;
}

/**
 * Every tile on the dashboard in one D1 batch. All of it is SQL aggregation —
 * no rows are shipped to the Worker just to be counted there.
 */
export async function adminOverview(db: D1Database, now: Date): Promise<AdminOverview> {
  const nowIso = `${now.toISOString().slice(0, 19)}Z`;
  const day1 = isoAgo(now, 24);
  const day7 = isoAgo(now, 24 * 7);
  // Midnight of the oldest day in the 14-day window, so a partial "today" at
  // either end cannot drop a bucket.
  const windowStart = `${new Date(now.getTime() - (OVERVIEW_DAYS - 1) * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)}T00:00:00Z`;

  const [users, events, rsvps, errors, signups, rsvpDays] = await db.batch([
    db
      .prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(role = 'player'), 0) AS players,
                COALESCE(SUM(role = 'organizer'), 0) AS organizers,
                COALESCE(SUM(role = 'admin'), 0) AS admins,
                COALESCE(SUM(suspended_at IS NOT NULL), 0) AS suspended,
                COALESCE(SUM(created_at >= ?1), 0) AS new_last_7d
           FROM users`,
      )
      .bind(day7),
    db
      .prepare(
        `SELECT COALESCE(SUM(status = 'scheduled' AND starts_at >= ?1), 0) AS upcoming,
                COALESCE(SUM(status = 'scheduled' AND starts_at >= ?1 AND rsvp_count >= capacity), 0) AS full,
                COALESCE(SUM(status = 'cancelled'), 0) AS cancelled,
                COALESCE(SUM(starts_at < ?1), 0) AS past
           FROM events`,
      )
      .bind(nowIso),
    db
      .prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(created_at >= ?1), 0) AS last_24h,
                COALESCE(SUM(created_at >= ?2), 0) AS last_7d
           FROM rsvps`,
      )
      .bind(day1, day7),
    db
      .prepare(
        `SELECT COALESCE(SUM(resolved_at IS NULL), 0) AS open,
                COALESCE(SUM(last_seen_at >= ?1), 0) AS last_24h
           FROM error_log`,
      )
      .bind(day1),
    db
      .prepare(
        `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n
           FROM users
          WHERE created_at >= ?1
          GROUP BY day`,
      )
      .bind(windowStart),
    db
      .prepare(
        `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n
           FROM rsvps
          WHERE created_at >= ?1
          GROUP BY day`,
      )
      .bind(windowStart),
  ]);

  // `batch` is typed as a sparse array; the statements above always produce a
  // row apiece, so the `?? 0` fallbacks below are belt and braces.
  const userRow = (users?.results as UserCountsRow[] | undefined)?.[0];
  const eventRow = (events?.results as EventCountsRow[] | undefined)?.[0];
  const rsvpRow = (rsvps?.results as RsvpCountsRow[] | undefined)?.[0];
  const errorRow = (errors?.results as ErrorCountsRow[] | undefined)?.[0];

  return {
    users: {
      total: userRow?.total ?? 0,
      players: userRow?.players ?? 0,
      organizers: userRow?.organizers ?? 0,
      admins: userRow?.admins ?? 0,
      suspended: userRow?.suspended ?? 0,
      newLast7d: userRow?.new_last_7d ?? 0,
    },
    events: {
      upcoming: eventRow?.upcoming ?? 0,
      full: eventRow?.full ?? 0,
      cancelled: eventRow?.cancelled ?? 0,
      past: eventRow?.past ?? 0,
    },
    rsvps: {
      total: rsvpRow?.total ?? 0,
      last24h: rsvpRow?.last_24h ?? 0,
      last7d: rsvpRow?.last_7d ?? 0,
    },
    errors: {
      open: errorRow?.open ?? 0,
      last24h: errorRow?.last_24h ?? 0,
    },
    signupsByDay: densify((signups?.results ?? []) as DayRow[], now, OVERVIEW_DAYS),
    rsvpsByDay: densify((rsvpDays?.results ?? []) as DayRow[], now, OVERVIEW_DAYS),
    recentActions: await listAudit(db, 10),
  };
}

interface UserCountsRow {
  total: number;
  players: number;
  organizers: number;
  admins: number;
  suspended: number;
  new_last_7d: number;
}
interface EventCountsRow {
  upcoming: number;
  full: number;
  cancelled: number;
  past: number;
}
interface RsvpCountsRow {
  total: number;
  last_24h: number;
  last_7d: number;
}
interface ErrorCountsRow {
  open: number;
  last_24h: number;
}
