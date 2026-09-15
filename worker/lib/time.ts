/**
 * Time handling.
 *
 * Everything in D1 is an ISO-8601 UTC string with second precision and a
 * trailing `Z` — exactly what SQLite's `strftime('%Y-%m-%dT%H:%M:%SZ','now')`
 * produces in the migration defaults and the seed. Keeping one single format in
 * the column matters because `starts_at >= ?` and `ORDER BY starts_at` are
 * *string* comparisons; a mix of `…:00Z` and `…:00.000Z` would still sort
 * correctly but would be a trap waiting for the next person.
 */

/** `2026-09-17T19:00:00Z` — UTC, second precision, no milliseconds. */
export function toIsoSeconds(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}

/** "Now", in the storage format. */
export function nowIso(now: Date = new Date()): string {
  return toIsoSeconds(now);
}
