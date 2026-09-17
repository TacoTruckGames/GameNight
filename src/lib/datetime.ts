/**
 * Event times are stored and transmitted as ISO-8601 UTC and rendered in the
 * reader's own time zone — a commuter should never have to do arithmetic.
 */

import type { DayGroup } from "./calendar";

const dayTime = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const dateOnly = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

const timeOnly = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

function parse(iso: string): Date | null {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** "Fri, Sep 18, 7:00 PM" — the card line. Falls back to the raw value. */
export function formatEventDateTime(iso: string): string {
  const at = parse(iso);
  return at ? dayTime.format(at) : iso;
}

/**
 * "7:30" and "PM", split — the card's time rail.
 *
 * Two parts because the rail stacks them: a 16px hour over a 10px suffix, so
 * every card's hour sits on the same baseline and the column can be read down
 * without the eye re-finding where each time starts. `formatToParts` rather
 * than splitting the formatted string, because the separator and the order are
 * the locale's business — a 24-hour locale yields no `dayPeriod` at all, and
 * the rail then correctly shows just "19:30".
 */
export function formatEventTime(iso: string): { hour: string; suffix: string } {
  const at = parse(iso);
  if (!at) return { hour: iso, suffix: "" };
  const parts = timeOnly.formatToParts(at);
  const suffix = parts.find((part) => part.type === "dayPeriod")?.value ?? "";
  const hour = parts
    .filter((part) => part.type !== "dayPeriod" && !(part.type === "literal" && /\s/.test(part.value)))
    .map((part) => part.value)
    .join("")
    .trim();
  return { hour, suffix };
}

/** "Friday, September 18, 2026 at 7:00 PM" — the detail page line. */
export function formatEventDateTimeLong(iso: string): string {
  const at = parse(iso);
  return at ? `${dateOnly.format(at)} at ${timeOnly.format(at)}` : iso;
}

/**
 * "Sep 18" for a `DayCount`'s `"YYYY-MM-DD"`.
 *
 * The admin day buckets are grouped in UTC server-side, so they are formatted in
 * UTC too — reading them in the local zone would shift every label by a day for
 * anyone west of Greenwich. The chart says "UTC" next to them.
 */
const utcDay = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

export function formatUtcDay(day: string): string {
  const at = parse(`${day}T00:00:00Z`);
  return at ? utcDay.format(at) : day;
}

/**
 * Has it happened already? The board shows past events in the calendar's day
 * pane, and three surfaces need to agree on the answer: the card greys itself,
 * the detail page tags itself, and the RSVP button refuses. An unparseable date
 * is treated as *not* past — the same defensive direction the rest of this file
 * takes, since wrongly greying a live event is worse than not greying a dead one.
 */
export function isPastEvent(iso: string, now: Date = new Date()): boolean {
  const at = parse(iso);
  return at !== null && at.getTime() <= now.getTime();
}

/**
 * The same day groups with everything that has already started taken out, and
 * any day left empty dropped entirely.
 *
 * This is what a calendar pane shows when no day is selected: the window on
 * screen, all of it, minus the part that is over. Deselecting a day is a request
 * for the overview, and an overview that opened on Monday's finished tables
 * would bury the thing you can still act on.
 *
 * It asks `isPastEvent` rather than comparing timestamps itself, so "past" means
 * the same here as it does on the card, on the detail page and in the RSVP
 * button — four surfaces, one rule.
 */
export function upcomingGroups<T extends { startsAt: string }>(
  groups: readonly DayGroup<T>[],
  now: Date = new Date(),
): DayGroup<T>[] {
  return groups
    .map((group) => ({ ...group, events: group.events.filter((event) => !isPastEvent(event.startsAt, now)) }))
    .filter((group) => group.events.length > 0);
}

/** Machine-readable value for `<time dateTime>`; empty when unparseable. */
export function toDateTimeAttr(iso: string): string {
  return parse(iso) ? iso : "";
}

/**
 * `datetime-local` gives (and wants) a zone-less local wall time; the API wants
 * UTC ISO. These two functions are the only place that conversion happens.
 */
export function localInputToIso(value: string): string | null {
  if (value === "") return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

function toLocalInput(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** The other direction: a stored UTC instant, as a local `datetime-local` value. */
export function isoToLocalInput(iso: string): string {
  const at = parse(iso);
  return at ? toLocalInput(at) : "";
}

/** Game nights start after work, so a new one defaults to 7pm, not to whatever o'clock it is now. */
const EVENING_HOUR = 19;

/**
 * The "Starts" default: 7pm local on the day `hoursFromNow` lands on. Keeps the
 * must-be-future contract — an evening already gone rolls to the next one.
 */
export function defaultEventStartValue(hoursFromNow: number): string {
  const at = new Date(Date.now() + hoursFromNow * 3_600_000);
  at.setHours(EVENING_HOUR, 0, 0, 0);
  if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1);
  return toLocalInput(at);
}
