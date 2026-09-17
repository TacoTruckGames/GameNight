/**
 * Shared test plumbing.
 *
 * Two rules the whole suite follows:
 *
 * 1. **Every fixture id is unique** (`crypto.randomUUID()` suffix). The tests
 *    share one local D1 database and one set of Durable Objects, so nothing may
 *    depend on per-test isolation. A test that would only pass in a clean world
 *    is a test that lies.
 * 2. **Requests go through `SELF.fetch`**, i.e. through the real Worker, its
 *    router, its middleware and its DO bindings — not through a hand-assembled
 *    call to a handler. The concurrency tests are only meaningful if the
 *    request path they exercise is the one production uses.
 */

import { SELF, env } from "cloudflare:test";

import type { EventPlace, Role } from "../shared/api-types";
import type { GameType } from "../shared/game-types";

export const BASE = "http://gamenight.test";

/** Storage format: ISO-8601 UTC, second precision — same as the worker's. */
export function isoSeconds(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}

export function inDays(days: number, from: Date = new Date()): string {
  return isoSeconds(new Date(from.getTime() + days * 24 * 60 * 60 * 1000));
}

function uid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

// ---------------------------------------------------------------- fixtures --

export interface SeededUser {
  id: string;
  name: string;
  role: Role;
}

/** Matches the id prefixes the seed and `POST /api/users` use, per role. */
const ID_PREFIX: Record<Role, string> = { player: "u", organizer: "org", admin: "adm" };
const ROLE_LABEL: Record<Role, string> = { player: "Player", organizer: "Org", admin: "Admin" };

export async function seedUser(options: { role?: Role; name?: string } = {}): Promise<SeededUser> {
  const role = options.role ?? "player";
  const id = uid(ID_PREFIX[role]);
  const name = options.name ?? `${ROLE_LABEL[role]} ${id.slice(-6)}`;
  await env.DB.prepare("INSERT INTO users (id, name, role) VALUES (?1, ?2, ?3)").bind(id, name, role).run();
  return { id, name, role };
}

/**
 * An admin, which no API route can create — `SIGNUP_ROLES` excludes the role on
 * purpose, so the only way in is the database, exactly as in production.
 */
export function seedAdmin(options: { name?: string } = {}): Promise<SeededUser> {
  return seedUser({ ...options, role: "admin" });
}

export async function seedUsers(count: number, options: { role?: Role } = {}): Promise<SeededUser[]> {
  const users: SeededUser[] = [];
  for (let i = 0; i < count; i += 1) users.push(await seedUser(options));
  return users;
}

export interface SeededEvent {
  id: string;
  organizerId: string;
  organizerName: string;
  title: string;
  gameType: GameType;
  startsAt: string;
  location: string;
  capacity: number;
  roomKey: string;
  /** The verified venue, or `null` for the free-text case (the default). */
  place: EventPlace | null;
}

export interface SeedEventOptions {
  capacity?: number;
  /** Players written straight into `rsvps` — i.e. seeded behind the DO's back. */
  rsvpPlayerIds?: string[];
  startsAt?: string;
  title?: string;
  location?: string;
  gameType?: GameType;
  organizer?: SeededUser;
  /**
   * A verified venue, written straight into the five place columns — the same
   * way `seed/seed.sql` does it, and with no API key or network involved.
   * Omitted means free text, which is the ordinary case and stays the default.
   */
  place?: EventPlace | null;
}

/**
 * Inserts an event (and optionally its RSVPs) directly into D1, exactly the way
 * `seed/seed.sql` does — no Durable Object involved. That is deliberate: it is
 * the cold-room case, so the hydration path is exercised by ordinary tests and
 * not only by the ones that name it.
 */
export async function seedEvent(options: SeedEventOptions = {}): Promise<SeededEvent> {
  const organizer = options.organizer ?? (await seedUser({ role: "organizer" }));
  const event: SeededEvent = {
    id: uid("evt"),
    organizerId: organizer.id,
    organizerName: organizer.name,
    title: options.title ?? `Test Event ${crypto.randomUUID().slice(0, 8)}`,
    gameType: options.gameType ?? "board",
    startsAt: options.startsAt ?? inDays(3),
    location: options.location ?? "Test Hall",
    capacity: options.capacity ?? 4,
    roomKey: crypto.randomUUID().replaceAll("-", "").slice(0, 16),
    place: options.place ?? null,
  };

  await env.DB.prepare(
    `INSERT INTO events (id, organizer_id, title, game_type, starts_at, location, capacity, rsvp_count, room_key,
                         place_id, place_address, place_lat, place_lng, place_resolved_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?9, ?10, ?11, ?12, ?13)`,
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
      event.place?.id ?? null,
      event.place?.address ?? null,
      event.place?.lat ?? null,
      event.place?.lng ?? null,
      event.place ? isoSeconds(new Date()) : null,
    )
    .run();

  const playerIds = options.rsvpPlayerIds ?? [];
  if (playerIds.length > 0) {
    await addRsvpsDirectly(event.id, playerIds);
  }

  return event;
}

/**
 * Write RSVP rows straight into D1, bypassing the Worker and the DO, and keep
 * `rsvp_count` honest. Used to seed pre-existing attendees and to create the
 * DO-vs-D1 divergence the resync path is supposed to heal.
 */
export async function addRsvpsDirectly(eventId: string, playerIds: string[]): Promise<void> {
  const base = Date.now();
  await env.DB.batch([
    ...playerIds.map((playerId, index) =>
      env.DB.prepare("INSERT OR IGNORE INTO rsvps (event_id, player_id, created_at) VALUES (?1, ?2, ?3)").bind(
        eventId,
        playerId,
        isoSeconds(new Date(base + index * 1000)),
      ),
    ),
    env.DB.prepare(
      "UPDATE events SET rsvp_count = (SELECT COUNT(*) FROM rsvps WHERE event_id = ?1) WHERE id = ?1",
    ).bind(eventId),
  ]);
}

// ------------------------------------------------------------- assertions --

export async function rsvpCount(eventId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM rsvps WHERE event_id = ?1")
    .bind(eventId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function projectedCount(eventId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT rsvp_count FROM events WHERE id = ?1")
    .bind(eventId)
    .first<{ rsvp_count: number }>();
  return row?.rsvp_count ?? -1;
}

/** The `EventRoom` stub the Worker would use for this event. */
export function roomStub(event: Pick<SeededEvent, "id" | "roomKey">) {
  return env.EVENT_ROOM.get(env.EVENT_ROOM.idFromName(`${event.id}:${event.roomKey}`));
}

// ----------------------------------------------------------------- client --

export interface ApiOptions {
  /** Sent as `X-User-Id`. Omit for an anonymous request. */
  as?: string | undefined;
  method?: string;
  body?: unknown;
  /** Sent verbatim, for the "what if the body is not JSON at all" cases. */
  rawBody?: string;
  headers?: Record<string, string>;
}

export interface ApiResult<T> {
  status: number;
  body: T;
}

export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.as) headers["X-User-Id"] = options.as;
  if (options.body !== undefined || options.rawBody !== undefined) headers["Content-Type"] = "application/json";

  const payload =
    options.rawBody !== undefined
      ? options.rawBody
      : options.body !== undefined
        ? JSON.stringify(options.body)
        : undefined;

  const response = await SELF.fetch(
    new Request(`${BASE}${path}`, {
      method: options.method ?? "GET",
      headers,
      ...(payload !== undefined ? { body: payload } : {}),
    }),
  );

  const text = await response.text();
  let body: unknown = text;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    /* leave `body` as the raw text so a failing assertion is readable */
  }
  return { status: response.status, body: body as T };
}

/** `PUT /api/events/:id/rsvp` as a given player. */
export function putRsvp(eventId: string, playerId: string) {
  return api(`/api/events/${eventId}/rsvp`, { method: "PUT", as: playerId });
}

/** `DELETE /api/events/:id/rsvp` as a given player. */
export function deleteRsvp(eventId: string, playerId: string) {
  return api(`/api/events/${eventId}/rsvp`, { method: "DELETE", as: playerId });
}
