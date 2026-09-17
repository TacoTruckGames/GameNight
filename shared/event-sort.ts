/**
 * How the public board orders its results.
 *
 * The board itself no longer offers the choice — every view there is
 * soonest-first, because a filter row already carrying search, game type and a
 * three-way View switch had no room left to spend on order. `?sort=` stays on
 * the API: it is a documented, tested query parameter, and the ranking below is
 * the interesting half of it.
 *
 * `date` is the default and the honest one: soonest first. `popular` ranks by
 * how close a table is to selling out — a 7-of-8 table outranks a 1-of-8 one —
 * with the date as the tie-break, so "nearly full and soon" floats to the top.
 * Tables that are already full sort last within `popular`: they are the most
 * popular of all, but you cannot join one, so they do not deserve the top of a
 * board whose whole purpose is grabbing a seat.
 */

export const EVENT_SORTS = ["date", "popular"] as const;

export type EventSort = (typeof EVENT_SORTS)[number];

export const DEFAULT_EVENT_SORT: EventSort = "date";
