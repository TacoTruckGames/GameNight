/**
 * The wire contract between the Worker and the SPA.
 *
 * TYPES ONLY — no zod, no runtime values. The client imports this with
 * `import type { … } from "../../shared/api-types"` and pays nothing at
 * runtime. Anything that needs to exist at runtime lives in `shared/schemas.ts`
 * (validation) or `shared/game-types.ts` (the enum + labels).
 *
 * Note for consumers: because this module has no value exports, always import
 * from it with `import type` (the tsconfigs use `verbatimModuleSyntax`).
 */

import type { GameType } from "./game-types";

// ------------------------------------------------------------------ users --

/**
 * `admin` is provisioned by the operator (seed / database), never by
 * self-signup — see `SIGNUP_ROLES` in `shared/schemas.ts`.
 */
export type Role = "player" | "organizer" | "admin";

export interface User {
  id: string;
  name: string;
  role: Role;
}

// ----------------------------------------------------------------- events --

/**
 * The list/card shape. Deliberately user-independent (no `myRsvp`) so
 * `GET /api/events` stays edge-cacheable; the client derives "mine" from
 * `GET /api/me/rsvps`.
 *
 * `attendeeCount` is `events.rsvp_count`, a write-through projection kept in
 * the same atomic D1 batch as the RSVP rows. `seatsLeft` and `isFull` are
 * derived server-side so the client never re-does the arithmetic.
 */
/** Cancellation is a status, not a delete: RSVP rows and the audit trail survive. */
export type EventStatus = "scheduled" | "cancelled";

/**
 * A venue Google could confirm, or `null` when the organizer typed free text —
 * which is an ordinary state, not a failure. `location` is always present and is
 * what a human reads; this is the machine-readable half that makes a map pin and
 * an exact deep link possible.
 *
 * Deliberately has no `name`: `displayName` is a Pro-tier Place Details field,
 * and `location` already carries the name the organizer chose. Every field here
 * is resolved server-side — a client may only ever send a `placeId`.
 */
export interface EventPlace {
  /** Google's id as *returned* by Place Details; it can differ from the one asked for if a place moved. */
  id: string;
  /** Google's canonical `formattedAddress`. Not length-capped: it is their string, not ours. */
  address: string;
  lat: number;
  lng: number;
}

export interface EventSummary {
  id: string;
  title: string;
  gameType: GameType;
  /** ISO-8601 UTC, e.g. "2026-09-17T19:00:00Z". Rendered in local time. */
  startsAt: string;
  /** The human label, always present. The venue's name lives here. */
  location: string;
  /** The map-linked venue, when there is one. */
  place: EventPlace | null;
  capacity: number;
  attendeeCount: number;
  seatsLeft: number;
  isFull: boolean;
  status: EventStatus;
  organizerName: string;
}

/** `GET /api/events/:id`. `myRsvp` is null when the request is unauthenticated. */
export type EventDetail = EventSummary & { myRsvp: boolean | null };

export interface Attendee {
  playerId: string;
  name: string;
  /** ISO-8601 UTC timestamp of when the RSVP was made. */
  rsvpAt: string;
}

/** `GET /api/events/:id/attendees` — owning organizer only. */
export interface AttendeesResponse {
  event: EventSummary;
  attendees: Attendee[];
}

// ------------------------------------------------------------------- rsvp --

/**
 * `confirmed` (201) and `already_confirmed` (200) both mean "you have a seat";
 * `cancelled` and `not_attending` (both 200) both mean "you do not". The pairs
 * exist so the UI can tell a real change from a retry — S2 in one field.
 */
export type RsvpStatus = "confirmed" | "already_confirmed" | "cancelled" | "not_attending";

export interface RsvpResponse {
  status: RsvpStatus;
  attendeeCount: number;
  capacity: number;
  seatsLeft: number;
}

// ------------------------------------------------------------------ errors --

export type ApiErrorCode =
  | "VALIDATION_FAILED" // 400 — `details` carries the per-field errors
  | "AUTH_REQUIRED" //     401 — no X-User-Id header
  | "UNKNOWN_USER" //      401 — X-User-Id not in users; client clears identity
  | "FORBIDDEN" //         403 — wrong role, or not the owning organizer
  | "ACCOUNT_SUSPENDED" // 403 — an admin suspended this account; client clears identity
  | "NOT_FOUND" //         404
  | "EVENT_FULL" //        409 — lost the race for the last seat (S1)
  | "EVENT_STARTED" //     409 — event is in the past
  | "EVENT_CANCELLED" //   409 — an admin cancelled the event; no new RSVPs
  | "RSVP_UNAVAILABLE" //  503 — DO/D1 write failed; safe to retry (PUT/DELETE are idempotent)
  | "PLACE_UNAVAILABLE" // 503 — the maps provider is down or over budget. Only an *admin* edit
  //                             sees this: posting an event degrades to free text instead.
  | "INTERNAL"; //         500

export interface ApiFieldError {
  /** Dotted path into the request body, e.g. "capacity" or "startsAt". */
  path: string;
  message: string;
}

/** Every non-2xx response from `/api/*` has exactly this shape. */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: ApiFieldError[];
  };
}

// ------------------------------------------------------------------- admin --
// `/api/admin/*`, role `admin` only. Timestamps are ISO-8601 UTC.

/** Offset pagination; `hasNext` comes from fetching pageSize + 1 rows. */
export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  hasNext: boolean;
}

export interface AdminUser extends User {
  createdAt: string;
  suspendedAt: string | null;
  suspendedReason: string | null;
  rsvpCount: number;
  hostedCount: number;
}

export interface AdminEvent extends EventSummary {
  organizerId: string;
  createdAt: string;
  cancelledAt: string | null;
}

export interface AdminEventDetail extends AdminEvent {
  attendees: Attendee[];
}

/** One row per distinct failure (fingerprint = scope + normalised message). */
export interface ErrorEntry {
  id: string;
  fingerprint: string;
  scope: string;
  message: string;
  stack: string | null;
  metadata: Record<string, unknown> | null;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
}

export type AuditAction =
  | "user.suspended"
  | "user.unsuspended"
  | "event.updated"
  | "event.cancelled"
  | "event.restored"
  | "event.attendee_removed"
  | "error.resolved"
  | "error.dismissed";

export interface AuditEntry {
  id: string;
  actorId: string;
  actorName: string;
  action: AuditAction;
  targetType: "user" | "event" | "error";
  targetId: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface DayCount {
  /** "YYYY-MM-DD" (UTC). */
  day: string;
  count: number;
}

export interface AdminOverview {
  users: { total: number; players: number; organizers: number; admins: number; suspended: number; newLast7d: number };
  events: { upcoming: number; full: number; cancelled: number; past: number };
  rsvps: { total: number; last24h: number; last7d: number };
  errors: { open: number; last24h: number };
  /** 14 entries, oldest first, zero-filled. */
  signupsByDay: DayCount[];
  rsvpsByDay: DayCount[];
  recentActions: AuditEntry[];
}
