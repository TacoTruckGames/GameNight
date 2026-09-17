/**
 * Civil-date helpers for the month calendar and the day-grouped agenda.
 *
 * Two rules keep this file honest:
 *
 * 1. A `DayKey` is a *civil* date — the day a human in some zone would call it,
 *    with the zone already applied. Deriving one from an instant is the only
 *    zone-aware operation here, and it goes through `Intl.DateTimeFormat`, never
 *    `toISOString()` (that answers in UTC, so every reader west of Greenwich
 *    would see evening events land on tomorrow). The `timeZone` parameter exists
 *    because the browser passes nothing and gets the reader's own zone, while the
 *    Workers test runtime is fixed to UTC — so the tests pass explicit zones to
 *    exercise the UTC-midnight boundary that the browser hits for real.
 *
 * 2. Once a date *is* a `DayKey`, zones are done with it. Grid arithmetic and
 *    label formatting run on `Date.UTC(...)` noon and UTC-pinned formatters, so
 *    "2026-09-18" reads as Friday the 18th everywhere, for everyone.
 *
 * Nothing here touches the DOM: the unit test type-checks under the worker
 * tsconfig, which has no DOM lib.
 */

export type DayKey = string; // "YYYY-MM-DD", a civil date, zone already applied

export interface YearMonth {
  year: number;
  month: number; // 1–12
}

export interface DayGroup<T = { startsAt: string }> {
  key: DayKey;
  events: T[];
}

export interface MonthCell {
  key: DayKey;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  /**
   * Strictly before today. Today is never past — a game tonight has not happened
   * yet, and greying the day you are standing on would be a lie.
   */
  isPast: boolean;
}

export type WeekStart = 0 | 1; // 0 = Sunday, 1 = Monday

/** The board's weeks start on Monday; the weekend sits together at the end. */
export const WEEK_STARTS_ON: WeekStart = 1;

const pad2 = (n: number) => String(n).padStart(2, "0");

/** One formatter per zone — constructing an `Intl.DateTimeFormat` is the expensive part. */
const dayKeyFormatters = new Map<string | undefined, Intl.DateTimeFormat>();

function dayKeyFormatter(timeZone?: string): Intl.DateTimeFormat {
  const cached = dayKeyFormatters.get(timeZone);
  if (cached) return cached;
  const made = new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  });
  dayKeyFormatters.set(timeZone, made);
  return made;
}

/**
 * The civil day `at` falls on in `timeZone` (default: the runtime's own zone).
 * Null when `at` is not a real instant.
 *
 * Read from `formatToParts` rather than the formatted string so locale ordering
 * ("09/18/2026" vs "18.09.2026") can't leak into the key.
 */
export function dayKey(at: Date, timeZone?: string): DayKey | null {
  if (Number.isNaN(at.getTime())) return null;
  let year = "";
  let month = "";
  let day = "";
  for (const part of dayKeyFormatter(timeZone).formatToParts(at)) {
    if (part.type === "year") year = part.value;
    else if (part.type === "month") month = part.value;
    else if (part.type === "day") day = part.value;
  }
  if (year === "" || month === "" || day === "") return null;
  return `${year.padStart(4, "0")}-${pad2(Number(month))}-${pad2(Number(day))}`;
}

/** "2026-09-18" → { year: 2026, month: 9, day: 18 }. */
export function parseDayKey(key: DayKey): { year: number; month: number; day: number } {
  return {
    year: Number(key.slice(0, 4)),
    month: Number(key.slice(5, 7)),
    day: Number(key.slice(8, 10)),
  };
}

export function monthOf(key: DayKey): YearMonth {
  const { year, month } = parseDayKey(key);
  return { year, month };
}

/** Cursor arithmetic that wraps years: {2026,12} + 1 → {2027,1}. */
export function shiftMonth(ym: YearMonth, delta: number): YearMonth {
  const zeroBased = ym.year * 12 + (ym.month - 1) + delta;
  return { year: Math.floor(zeroBased / 12), month: (((zeroBased % 12) + 12) % 12) + 1 };
}

export function sameMonth(a: YearMonth, b: YearMonth): boolean {
  return a.year === b.year && a.month === b.month;
}

/**
 * Buckets events by civil day, in first-seen key order and preserving input
 * order within a bucket — so a date-sorted list comes back as chronological
 * groups without a second sort. Events whose `startsAt` won't parse are skipped;
 * the agenda shows what it can rather than blanking out.
 */
export function groupByDay<T extends { startsAt: string }>(
  events: readonly T[],
  timeZone?: string,
): DayGroup<T>[] {
  const buckets = new Map<DayKey, T[]>();
  for (const event of events) {
    const key = dayKey(new Date(event.startsAt), timeZone);
    if (key === null) continue;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(event);
    else buckets.set(key, [event]);
  }
  return Array.from(buckets, ([key, grouped]) => ({ key, events: grouped }));
}

/**
 * The month's cells as N×7 rows (4–6 of them). Leading and trailing cells belong
 * to the neighbouring months — `inMonth` is false, but they carry their real key
 * so clicking one still means something.
 *
 * Pure civil arithmetic through `Date.UTC`: the grid for September 2026 is the
 * same grid in every zone, so no reader ever sees a calendar off by a day.
 */
export function buildMonthGrid(
  ym: YearMonth,
  todayKey: DayKey | null,
  weekStartsOn: WeekStart = WEEK_STARTS_ON,
): MonthCell[][] {
  const { year, month } = ym;
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const lead = (firstDow - weekStartsOn + 7) % 7;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const rows = Math.ceil((lead + days) / 7);

  return Array.from({ length: rows }, (_row, r) =>
    Array.from({ length: 7 }, (_cell, c): MonthCell => {
      const at = new Date(Date.UTC(year, month - 1, 1 - lead + r * 7 + c));
      const key = `${String(at.getUTCFullYear()).padStart(4, "0")}-${pad2(at.getUTCMonth() + 1)}-${pad2(at.getUTCDate())}`;
      return {
        key,
        day: at.getUTCDate(),
        inMonth: at.getUTCFullYear() === year && at.getUTCMonth() === month - 1,
        isToday: key === todayKey,
        // `DayKey` is zero-padded `YYYY-MM-DD`, so lexicographic order is date
        // order — no parsing, no zone, no off-by-one. With no `todayKey` there
        // is no "now" to be before, so nothing is past.
        isPast: todayKey !== null && key < todayKey,
      };
    }),
  );
}

/**
 * The label formatters are pinned to UTC and fed the key's own noon, so a
 * `DayKey` formats identically wherever it is read. Locale stays the runtime's.
 */
const monthLabel = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
const dayHeading = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const dayLong = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});
const weekdayShort = new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" });

/** Noon, so no formatter rounding or DST edge can nudge the date. */
function noonUtc(key: DayKey): Date {
  const { year, month, day } = parseDayKey(key);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

/** "September 2026" — the calendar header. */
export function formatMonthLabel(ym: YearMonth): string {
  return monthLabel.format(new Date(Date.UTC(ym.year, ym.month - 1, 1, 12)));
}

/** "Fri, Sep 18" — an agenda day heading. */
export function formatDayHeading(key: DayKey): string {
  return dayHeading.format(noonUtc(key));
}

/** "Friday, September 18" — the aria-label of a day cell. */
export function formatDayLong(key: DayKey): string {
  return dayLong.format(noonUtc(key));
}

/**
 * ["Mon", …, "Sun"], rotated for `weekStartsOn`. 2024-01-01 was a Monday, so
 * offsetting from it gives a real weekday name without hard-coding English.
 */
export function weekdayLabels(weekStartsOn: WeekStart = WEEK_STARTS_ON): string[] {
  return Array.from({ length: 7 }, (_label, i) =>
    weekdayShort.format(new Date(Date.UTC(2024, 0, 1 + ((weekStartsOn + i + 6) % 7)))),
  );
}

/** "1 event" / "3 events". */
export function eventCountLabel(n: number): string {
  return `${n} event${n === 1 ? "" : "s"}`;
}
