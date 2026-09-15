/**
 * Event times are stored and transmitted as ISO-8601 UTC and rendered in the
 * reader's own time zone — a commuter should never have to do arithmetic.
 */

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

/** "Friday, September 18, 2026 at 7:00 PM" — the detail page line. */
export function formatEventDateTimeLong(iso: string): string {
  const at = parse(iso);
  return at ? `${dateOnly.format(at)} at ${timeOnly.format(at)}` : iso;
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

/** Local wall time `n` hours from now, formatted for a `datetime-local` value. */
export function defaultLocalInputValue(hoursFromNow: number): string {
  const at = new Date(Date.now() + hoursFromNow * 3_600_000);
  at.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}
