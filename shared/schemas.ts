/**
 * Request validation shared by the Worker and the SPA (zod 4).
 *
 * The server is the only enforcement point — the client uses these schemas
 * purely to fail fast and show field errors before a round trip.
 */

import { z } from "zod";
import type { Role } from "./api-types";
import { GAME_TYPES } from "./game-types";

export const TITLE_MAX = 80;
export const LOCATION_MAX = 120;
export const NAME_MAX = 40;
export const SEARCH_MAX = 80;
export const CAPACITY_MIN = 1;
export const CAPACITY_MAX = 500;

export const gameTypeSchema = z.enum(GAME_TYPES);

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

/** One tuple, so the zod enum and the `Role` union cannot drift apart. */
export const ROLES = ["player", "organizer"] as const satisfies readonly Role[];

export const roleSchema = z.enum(ROLES);

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
  })
  .transform(({ q, gameType }) => ({
    q: q !== undefined && q.trim() !== "" ? q.trim() : undefined,
    gameType: gameType !== undefined && gameType !== "" ? gameType : undefined,
  }));

export type EventsQuery = z.infer<typeof eventsQuerySchema>;
export type EventsQueryInput = z.input<typeof eventsQuerySchema>;
