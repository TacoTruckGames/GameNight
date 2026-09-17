/**
 * Strip anything that looks like a credential before a string is stored or
 * logged. The two shapes that matter here: a `key=`/`signature=` query
 * parameter on a Google URL, and a bare Google API key. Applied to every error
 * message and stack that reaches `error_log` — not only to the metadata
 * callers remember to scrub — because the log is readable from `/admin`, and
 * `/admin` is readable by anyone.
 */
export function redact(value: string): string {
  return value
    .replace(/\b(key|signature)=[^&\s"']*/gi, "$1=REDACTED")
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, "AIzaREDACTED");
}
