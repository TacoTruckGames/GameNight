/**
 * The backend error log.
 *
 * Two properties matter more than completeness:
 *
 * 1. **It never changes the outcome of a request.** `console.error` happens
 *    first (so the Workers log has it whatever D1 does), and the write is
 *    wrapped so a failing database cannot turn a handled 500 into an unhandled
 *    throw inside the error handler.
 * 2. **One row per distinct failure, counted.** A hot loop should read as
 *    "×4,912", not scroll for a page. The dedup key is a fingerprint over the
 *    *normalised* message, so `Event evt_9f3… is not in D1` and the same failure
 *    for another event collapse into one entry.
 *
 * A recurrence re-opens a resolved row (`resolved_at = NULL`): if it is still
 * happening, it is not fixed.
 */

import { redact } from "./redact";

const MESSAGE_MAX = 300;
const STACK_MAX = 4096;

/**
 * Strip the parts of a message that vary per occurrence: uuids, long hex runs
 * (ids, room keys, request ids) and bare integers. What is left is the shape of
 * the failure.
 *
 * No `\b` anchors on the first two: our ids are `evt_<uuid>`, and `_` is a word
 * character, so a word boundary would never fire between the prefix and the
 * part that actually varies. Uuids go first because they contain the hyphens
 * that would otherwise split them into runs too short to match.
 */
export function normalise(message: string): string {
  return message
    .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, "<id>")
    .replace(/[0-9a-fA-F]{16,}/g, "<id>")
    .replace(/\b\d+\b/g, "<n>")
    .slice(0, MESSAGE_MAX);
}

/** djb2 — tiny, stable, and nothing here is security-sensitive. */
export function djb2(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  // `>>> 0` back to unsigned; base 36 keeps the fingerprint short.
  return (hash >>> 0).toString(36);
}

export function fingerprintFor(scope: string, message: string): string {
  return `${scope}:${djb2(normalise(message))}`;
}

function describe(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) {
    return {
      message: error.message || error.name,
      stack: error.stack ? error.stack.slice(0, STACK_MAX) : null,
    };
  }
  return { message: String(error).slice(0, MESSAGE_MAX), stack: null };
}

/**
 * Log an unexpected failure and record it, best effort.
 *
 * `scope` is the coarse location — `http.PUT /api/events/:id/rsvp`,
 * `rsvp.room` — and is part of the fingerprint, so the same message from two
 * places stays two rows.
 */
export async function reportError(
  db: D1Database,
  scope: string,
  error: unknown,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const described = describe(error);
  // Redacted *before* either sink. Workers Logs and `error_log` are both read
  // by people, and an upstream URL with a key on it is exactly the kind of
  // thing that ends up in a message.
  const message = redact(described.message);
  const stack = described.stack === null ? null : redact(described.stack);
  console.error(`[${scope}]`, message);

  try {
    const now = new Date().toISOString().slice(0, 19) + "Z";
    await db
      .prepare(
        `INSERT INTO error_log (id, fingerprint, scope, message, stack, metadata,
                                count, first_seen_at, last_seen_at, resolved_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7, NULL)
         ON CONFLICT(fingerprint) DO UPDATE SET
           count = count + 1,
           last_seen_at = excluded.last_seen_at,
           message = excluded.message,
           stack = excluded.stack,
           metadata = excluded.metadata,
           -- Still happening means still open, whatever an operator ticked.
           resolved_at = NULL`,
      )
      .bind(
        `err_${crypto.randomUUID()}`,
        fingerprintFor(scope, message),
        scope,
        message.slice(0, MESSAGE_MAX),
        stack,
        metadata ? JSON.stringify(metadata) : null,
        now,
      )
      .run();
  } catch (writeFailure) {
    // The log is a convenience, never a dependency. Swallow.
    console.error("error_log write failed", writeFailure);
  }
}
