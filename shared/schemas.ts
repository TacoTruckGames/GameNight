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
/**
 * Long enough for the paragraph that decides whether someone comes — the
 * edition, the skill level, the door code — and short enough that the detail
 * page stays a page rather than a document.
 */
export const DESCRIPTION_MAX = 500;
/** Google documents no maximum for a place id; 512 is generous and bounds the column. */
export const PLACE_ID_MAX = 512;
/** A uuid in practice, but kept loose — see `placeSessionToken` below. */
export const PLACE_SESSION_MAX = 64;
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
    /**
     * Optional prose. Three states, and they are genuinely different:
     *
     * - **absent** — the field was not sent. On a create that is "no
     *   description"; on an admin patch it is "leave it alone".
     * - **`""`** — a textarea the organizer never typed in. It normalises to
     *   `undefined` rather than being stored, because an empty string in the
     *   column would render as an empty paragraph and read as "the organizer
     *   wrote nothing on purpose". The column stores NULL or real prose,
     *   never the empty string.
     * - **`null`** — an explicit clear, the same convention `placeId` uses for
     *   unlinking a venue. This is the one an admin sends to remove a
     *   description, because `""` means "no change" once `.partial()` has
     *   turned absence into the default.
     */
    description: z
      .string()
      .trim()
      .max(DESCRIPTION_MAX, `Description must be ${DESCRIPTION_MAX} characters or fewer`)
      .nullish()
      .transform((value) => (value === "" ? undefined : value)),
    /**
     * The only piece of place data a client may send. The server resolves the
     * address and coordinates itself — a client-supplied latitude is not
     * evidence of anything.
     *
     * Absent means "free text"; an explicit `null` on an admin patch means
     * "unlink the venue". Both are ordinary, so neither is an error.
     */
    placeId: z.string().trim().min(1).max(PLACE_ID_MAX).nullish(),
    /**
     * Google's autocomplete session token, so the keystrokes and the final
     * lookup bill as one session. Deliberately lax validation: a billing hint
     * must never be the reason an event fails to post, so a malformed token is
     * dropped by the places client rather than rejected with a 400 here.
     */
    placeSessionToken: z.string().trim().max(PLACE_SESSION_MAX).optional(),
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

// ---------------------------------------------------------- the date window --

/**
 * The optional **date window**, half-open: `from` inclusive, `to` exclusive.
 * Absent, a list is upcoming-only (`starts_at >= now`); present, `now` stops
 * applying and past events come back. The calendar is the caller that needed it
 * first — a month grid has to show the days behind today — and the two `/api/me`
 * lists take the same window for the week agenda.
 *
 * A window rather than an `includePast` flag on purpose: past-inclusive with
 * `ORDER BY starts_at` would return oldest-first and could exhaust the 200-row
 * cap long before reaching anything still joinable. A window is bounded by
 * construction, so what comes back is always the span the caller asked about.
 *
 * Defined once, in three pieces, because three endpoints now share the rule and
 * a second copy of it is a second chance to drift.
 */
const windowEndSchema = z.union([
  z.iso.datetime({ offset: true, message: "Must be an ISO-8601 date-time" }),
  z.literal(""),
]);

/** Spread into any query object that takes the window. */
export const dateWindowShape = {
  from: windowEndSchema.optional(),
  to: windowEndSchema.optional(),
};

export interface DateWindowQuery {
  from: string | undefined;
  to: string | undefined;
}

/** Blank (`?from=&to=`) is absence, not a value — one "no window" case downstream. */
function normaliseWindow({ from, to }: { from?: string | undefined; to?: string | undefined }): DateWindowQuery {
  return {
    from: from !== undefined && from !== "" ? from : undefined,
    to: to !== undefined && to !== "" ? to : undefined,
  };
}

/**
 * Half a window is a caller bug, not something to guess the other end of: a
 * lone `from` would silently mean "everything from here on, past included"
 * and a lone `to` "everything ever, up to here". The issue is reported
 * against the *missing* half, which is the field the caller has to add.
 */
function requireWholeWindow(query: DateWindowQuery, ctx: z.core.$RefinementCtx<DateWindowQuery>): void {
  if ((query.from === undefined) === (query.to === undefined)) return;
  const missing = query.from === undefined ? "from" : "to";
  const given = missing === "from" ? "to" : "from";
  ctx.addIssue({
    code: "custom",
    path: [missing],
    message: `Send both from and to, or neither — ${given} was given without ${missing}`,
  });
}

/** The whole query string of `GET /api/me/rsvps` and `GET /api/me/hosted`. */
export const dateWindowQuerySchema = z
  .object(dateWindowShape)
  .transform(normaliseWindow)
  .superRefine(requireWholeWindow);

// --------------------------------------------------------- GET /api/events --

/**
 * Query string, so every field arrives as a string or not at all. Blank values
 * (`?q=&gameType=`) normalise to `undefined` so the route has one "absent"
 * case to branch on.
 *
 * `from`/`to` are the shared date window above, rule and all.
 */
/**
 * `GET /api/users` is a picker, not a directory. Unbounded, it grew with the
 * board — at 2,000 registered players it was 170 KB and a 2,001-option
 * `<select>` on the landing page — so it is capped, and ordered by signup so the
 * seeded personas (the people a reviewer is looking for) come first.
 */
export const USERS_LIMIT_DEFAULT = 50;
export const USERS_LIMIT_MAX = 200;

export const usersQuerySchema = z
  .object({
    role: z.union([z.enum(["player", "organizer", "admin"]), z.literal("")]).optional(),
    limit: z.coerce.number().int().min(1).max(USERS_LIMIT_MAX, `limit must be ${USERS_LIMIT_MAX} or fewer`).optional(),
  })
  .transform(({ role, limit }) => ({
    role: role !== undefined && role !== "" ? role : undefined,
    limit: limit ?? USERS_LIMIT_DEFAULT,
  }));

export const eventsQuerySchema = z
  .object({
    q: z.string().max(SEARCH_MAX, `Search must be ${SEARCH_MAX} characters or fewer`).optional(),
    gameType: z.union([gameTypeSchema, z.literal("")]).optional(),
    sort: z.union([eventSortSchema, z.literal("")]).optional(),
    ...dateWindowShape,
  })
  .transform(({ q, gameType, sort, from, to }) => ({
    q: q !== undefined && q.trim() !== "" ? q.trim() : undefined,
    gameType: gameType !== undefined && gameType !== "" ? gameType : undefined,
    // `sort` is the one query param with a meaningful default rather than an
    // "absent" case: a list always has an order.
    sort: sort !== undefined && sort !== "" ? sort : DEFAULT_EVENT_SORT,
    ...normaliseWindow({ from, to }),
  }))
  .superRefine(requireWholeWindow);

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
 *
 * Because it is `createEventSchema(now).partial()`, "absent" always means
 * "leave it alone" — so the two fields that can be *removed* rather than
 * changed, `placeId` and `description`, are removed by sending an explicit
 * `null`. Sending `""` for a description is not a clear; it normalises to
 * absent, which here is a no-op (and a 400 if it was the only field sent).
 *
 * One schema, two routes: the admin's `PATCH /api/admin/events/:id` and the
 * organizer's `PATCH /api/events/:id`. They differ in *who* may call them and
 * in nothing else — an organizer editing their own table and an operator
 * fixing a bad one are the same edit, and a second schema would only be a
 * second place for the rules to drift.
 */
export function eventPatchSchema(now: Date) {
  return createEventSchema(now)
    .partial()
    .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
      message: "Change at least one field",
    });
}
export type EventPatch = z.infer<ReturnType<typeof eventPatchSchema>>;
