/**
 * How the public board orders its results.
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

export const EVENT_SORT_LABELS: Record<EventSort, string> = {
  date: "Date",
  popular: "Popular",
};
