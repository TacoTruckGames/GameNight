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

/**
 * A validated `?from=&to=` window in the storage format.
 *
 * Both ends have to make this trip because `starts_at >= ?` is a *string*
 * comparison: a client that sends an offset (`2026-09-14T00:00:00-07:00`) or
 * milliseconds is asking the right question in the wrong alphabet, and would
 * quietly compare wrong. The schema has already established these parse; this
 * is the one place that re-spells them, for all three callers.
 */
export function toStorageWindow({ from, to }: { from?: string | undefined; to?: string | undefined }): {
  from: string | undefined;
  to: string | undefined;
} {
  return {
    from: from === undefined ? undefined : toIsoSeconds(new Date(from)),
    to: to === undefined ? undefined : toIsoSeconds(new Date(to)),
  };
}
