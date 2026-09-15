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

export type Role = "player" | "organizer";

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
export interface EventSummary {
  id: string;
  title: string;
  gameType: GameType;
  /** ISO-8601 UTC, e.g. "2026-09-17T19:00:00Z". Rendered in local time. */
  startsAt: string;
  location: string;
  capacity: number;
  attendeeCount: number;
  seatsLeft: number;
  isFull: boolean;
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
  | "NOT_FOUND" //         404
  | "EVENT_FULL" //        409 — lost the race for the last seat (S1)
  | "EVENT_STARTED" //     409 — event is in the past
  | "RSVP_UNAVAILABLE" //  503 — DO/D1 write failed; safe to retry (PUT/DELETE are idempotent)
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
