/**
 * Request validation shared by the Worker and the SPA (zod 4).
 *
 * The server is the only enforcement point — the client uses these schemas
 * purely to fail fast and show field errors before a round trip.
 */

import { z } from "zod";
import type { Role } from "./api-types";
import { DEFAULT_EVENT_SORT, EVENT_SORTS } from "./event-sort";
import { GAME_TYPES } from "./game-types";

export const TITLE_MAX = 80;
export const LOCATION_MAX = 120;
export const NAME_MAX = 40;
export const SEARCH_MAX = 80;
export const CAPACITY_MIN = 1;
export const CAPACITY_MAX = 500;

export const gameTypeSchema = z.enum(GAME_TYPES);
export const eventSortSchema = z.enum(EVENT_SORTS);

// ------------------------------------------------------- POST /api/events --

/**
 * Takes `now` so "the event must be in the future" is deterministic in tests
 * and so a request is judged against the time the server received it.
 *
 * Note that `capacity` uses `z.int()`, not a coercion: `"8"`, `0`, `1.5` and
 * `501` are all rejected rather than quietly repaired.
 */
export function createEventSchema(now: Date) {
  return z.object({
    title: z.string().trim().min(1, "Title is required").max(TITLE_MAX, `Title must be ${TITLE_MAX} characters or fewer`),
    gameType: gameTypeSchema,
    startsAt: z
      .iso
      .datetime({ offset: true, message: "Start time must be an ISO-8601 date-time" })
      // Unparseable values short-circuit to `true` so a malformed date reports
      // one issue (the format one) instead of two.
      .refine(
        (value) => {
          const at = Date.parse(value);
          return Number.isNaN(at) || at > now.getTime();
        },
        { message: "Start time must be in the future" },
      ),
    location: z
      .string()
      .trim()
      .min(1, "Location is required")
      .max(LOCATION_MAX, `Location must be ${LOCATION_MAX} characters or fewer`),
    capacity: z
      .int(`Capacity must be a whole number between ${CAPACITY_MIN} and ${CAPACITY_MAX}`)
      .min(CAPACITY_MIN, `Capacity must be at least ${CAPACITY_MIN}`)
      .max(CAPACITY_MAX, `Capacity must be at most ${CAPACITY_MAX}`),
  });
}

export type CreateEventSchema = ReturnType<typeof createEventSchema>;
export type CreateEventInput = z.infer<CreateEventSchema>;

// -------------------------------------------------------- POST /api/users --

/**
 * The roles self-signup may create. `admin` is deliberately absent: it exists in
 * the `Role` union and the database, but only the operator (seed / SQL) can
 * grant it. `satisfies` keeps the tuple inside the union.
 */
export const SIGNUP_ROLES = ["player", "organizer"] as const satisfies readonly Role[];

export const roleSchema = z.enum(SIGNUP_ROLES);

/** Every role, for admin-side filters. */
export const ALL_ROLES = ["player", "organizer", "admin"] as const satisfies readonly Role[];

/**
 * Self-signup. `role` is optional and defaults to `player`, so a caller that
 * posts only a name still gets the old behaviour.
 *
 * Letting the caller pick the role is a demo-board decision, not an oversight:
 * the picker already signs anyone in as a seeded organizer, so there is no
 * privilege boundary here to protect. What each role may *do* is still decided
 * server-side on every route. See the README's "before real traffic" list.
 */
export const createUserSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(NAME_MAX, `Name must be ${NAME_MAX} characters or fewer`),
  role: roleSchema.default("player"),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

// --------------------------------------------------------- GET /api/events --

/**
 * Query string, so every field arrives as a string or not at all. Blank values
 * (`?q=&gameType=`) normalise to `undefined` so the route has one "absent"
 * case to branch on.
 */
export const eventsQuerySchema = z
  .object({
    q: z.string().max(SEARCH_MAX, `Search must be ${SEARCH_MAX} characters or fewer`).optional(),
    gameType: z.union([gameTypeSchema, z.literal("")]).optional(),
    sort: z.union([eventSortSchema, z.literal("")]).optional(),
  })
  .transform(({ q, gameType, sort }) => ({
    q: q !== undefined && q.trim() !== "" ? q.trim() : undefined,
    gameType: gameType !== undefined && gameType !== "" ? gameType : undefined,
    // `sort` is the one query param with a meaningful default rather than an
    // "absent" case: a list always has an order.
    sort: sort !== undefined && sort !== "" ? sort : DEFAULT_EVENT_SORT,
  }));

export type EventsQuery = z.infer<typeof eventsQuerySchema>;
export type EventsQueryInput = z.input<typeof eventsQuerySchema>;

// ------------------------------------------------------------ /api/admin --

export const SUSPEND_REASON_MAX = 200;
export const ADMIN_PAGE_SIZE = 50;

/** Blank query-string values normalise to `undefined`, as in `eventsQuerySchema`. */
const blankToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

const pageSchema = z.preprocess(
  (value) => (typeof value === "string" && value !== "" ? Number(value) : value),
  z.int().min(1).optional(),
);

export const suspendSchema = z.object({
  reason: z.string().trim().max(SUSPEND_REASON_MAX, `Reason must be ${SUSPEND_REASON_MAX} characters or fewer`).optional(),
});
export type SuspendInput = z.infer<typeof suspendSchema>;

export const adminUsersQuerySchema = z.object({
  q: z.preprocess(blankToUndefined, z.string().trim().max(SEARCH_MAX).optional()),
  role: z.preprocess(blankToUndefined, z.enum(ALL_ROLES).optional()),
  status: z.preprocess(blankToUndefined, z.enum(["active", "suspended"]).optional()),
  page: pageSchema,
});
export type AdminUsersQuery = z.infer<typeof adminUsersQuerySchema>;

export const adminEventsQuerySchema = z.object({
  q: z.preprocess(blankToUndefined, z.string().trim().max(SEARCH_MAX).optional()),
  when: z.preprocess(blankToUndefined, z.enum(["upcoming", "past", "all"]).optional()),
  status: z.preprocess(blankToUndefined, z.enum(["scheduled", "cancelled"]).optional()),
  page: pageSchema,
});
export type AdminEventsQuery = z.infer<typeof adminEventsQuerySchema>;

export const adminErrorsQuerySchema = z.object({
  status: z.preprocess(blankToUndefined, z.enum(["open", "resolved", "all"]).optional()),
});
export type AdminErrorsQuery = z.infer<typeof adminErrorsQuerySchema>;

/**
 * Admin edit of an event: every create field, each optional, same rules. The
 * capacity floor (not below the current attendee count) needs the database and
 * is enforced in the route, not here.
 */
export function adminEventPatchSchema(now: Date) {
  return createEventSchema(now)
    .partial()
    .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
      message: "Change at least one field",
    });
}
export type AdminEventPatch = z.infer<ReturnType<typeof adminEventPatchSchema>>;
