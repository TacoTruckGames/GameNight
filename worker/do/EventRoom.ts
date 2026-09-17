/**
 * `EventRoom` — one Durable Object per event, the linearization point for RSVPs.
 *
 * Why a DO at all, when the guarded D1 insert below already makes over-booking
 * impossible? Because "who is allowed in this event" is per-event state with a
 * per-event write spike, and a DO is the only primitive that gives us a single
 * writer for it. The DO answers duplicates without a database round trip, keeps
 * one event's stampede off every other event, and is where a waitlist or a live
 * seat-count push would go later — with no rewrite. The guarded insert stays
 * underneath as defense in depth: if a DO were ever lost, replaced or bypassed,
 * D1 still cannot over-book.
 *
 * Three runtime facts shape the implementation:
 *
 * - `ctx.storage.sql.exec()` is *synchronous* and, while a DO is input-gated,
 *   uninterruptible. But `await env.DB.batch(...)` opens the gate, so two
 *   concurrent `rsvp()` calls can interleave around that await. Hence the
 *   promise-chain mutex: every mutation runs strictly after the previous one
 *   has settled.
 * - We do *not* use `blockConcurrencyWhile`. A throw inside it resets the
 *   object, which would turn a transient D1 error into a dropped DO, and it has
 *   a 30 s ceiling that a queue of RSVPs could plausibly hit.
 * - A DO cannot read its own name, so `eventId` travels on every call and
 *   hydration is lazy — which is exactly what makes the SQL-seeded events (and
 *   any recovery from storage loss) work.
 */

import { DurableObject } from "cloudflare:workers";

import { nowIso } from "../lib/time";

export type RsvpOutcomeKind = "created" | "already" | "full";
export type CancelOutcomeKind = "cancelled" | "not_attending";

export interface RsvpOutcome {
  kind: RsvpOutcomeKind;
  attendeeCount: number;
  capacity: number;
}

export interface CancelOutcome {
  kind: CancelOutcomeKind;
  attendeeCount: number;
  capacity: number;
}

/** Thrown when D1 no longer has the event the caller is asking about. */
export class EventVanishedError extends Error {
  constructor(eventId: string) {
    super(`Event ${eventId} is not in D1`);
    this.name = "EventVanishedError";
  }
}

interface CountsRow {
  rsvp_count: number;
  capacity: number;
}

export class EventRoom extends DurableObject<Env> {
  /**
   * The mutex. Every mutation is appended to this chain, so `doRsvp`/`doCancel`
   * bodies never interleave even though they await D1 in the middle.
   */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        event_id TEXT PRIMARY KEY,
        capacity INTEGER NOT NULL,
        hydrated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS members (
        player_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      );
    `);
  }

  // ------------------------------------------------------------- RPC API --

  rsvp(eventId: string, playerId: string): Promise<RsvpOutcome> {
    return this.serialize(() => this.doRsvp(eventId, playerId));
  }

  cancel(eventId: string, playerId: string): Promise<CancelOutcome> {
    return this.serialize(() => this.doCancel(eventId, playerId));
  }

  // --------------------------------------------------------------- mutex --

  /**
   * How many calls are inside `serialize` right now — running or waiting —
   * and the most there have ever been at once. Read by the concurrency suite
   * through `runInDurableObject`, and by nothing else: it is how a race test
   * proves it was a race. Twenty-five `Promise.all`ed fetches that the runtime
   * happened to deliver one at a time would pass every tally and prove
   * nothing; a peak of two or more means the mutex actually held something
   * back.
   */
  contention = { current: 0, peak: 0 };

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    this.contention.current += 1;
    this.contention.peak = Math.max(this.contention.peak, this.contention.current);
    const release = () => {
      this.contention.current -= 1;
    };
    // `.then(fn, fn)` so a rejected predecessor still lets the next call run:
    // one failed RSVP must not wedge the room.
    const run = this.chain.then(fn, fn);
    run.then(release, release);
    // Park the rejection here; the caller still gets `run` (and its rejection).
    this.chain = run.catch(() => {});
    return run;
  }

  // ----------------------------------------------------------- hydration --

  /**
   * Populate `meta`/`members` from D1 the first time this room is used.
   *
   * This is what makes a SQL-seeded event (including the FULL one) behave
   * correctly on its very first RSVP, and it doubles as the recovery path if
   * the DO's own storage is ever lost: D1 is the system of record, the room is
   * a cache of it. Returns the event's capacity.
   */
  private async ensureHydrated(eventId: string): Promise<number> {
    const existing = this.ctx.storage.sql
      .exec<{ capacity: number }>("SELECT capacity FROM meta WHERE event_id = ?", eventId)
      .toArray();
    const cached = existing[0];
    if (cached) return cached.capacity;

    return this.hydrate(eventId);
  }

  /** Unconditionally rebuild `meta`/`members` from D1. Returns capacity. */
  private async hydrate(eventId: string): Promise<number> {
    const [eventResult, rsvpResult] = await this.env.DB.batch([
      this.env.DB.prepare("SELECT capacity FROM events WHERE id = ?1").bind(eventId),
      this.env.DB.prepare("SELECT player_id, created_at FROM rsvps WHERE event_id = ?1 ORDER BY created_at").bind(
        eventId,
      ),
    ]);

    const event = (eventResult?.results as { capacity: number }[] | undefined)?.[0];
    if (!event) throw new EventVanishedError(eventId);

    const members = (rsvpResult?.results ?? []) as { player_id: string; created_at: string }[];
    const capacity = event.capacity;
    const hydratedAt = nowIso();

    // One synchronous transaction: the room is never observed half-hydrated.
    this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      sql.exec("DELETE FROM meta");
      sql.exec("DELETE FROM members");
      sql.exec("INSERT INTO meta (event_id, capacity, hydrated_at) VALUES (?, ?, ?)", eventId, capacity, hydratedAt);
      for (const member of members) {
        sql.exec("INSERT INTO members (player_id, created_at) VALUES (?, ?)", member.player_id, member.created_at);
      }
    });

    return capacity;
  }

  // ------------------------------------------------------- local helpers --

  private isMember(playerId: string): boolean {
    return (
      this.ctx.storage.sql
        .exec<{ present: number }>("SELECT 1 AS present FROM members WHERE player_id = ?", playerId)
        .toArray().length > 0
    );
  }

  private memberCount(): number {
    const row = this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM members").toArray()[0];
    return row?.n ?? 0;
  }

  // ---------------------------------------------------------------- rsvp --

  private async doRsvp(eventId: string, playerId: string): Promise<RsvpOutcome> {
    const capacity = await this.ensureHydrated(eventId);

    // Duplicate retry — answered without touching D1. This is S2's fast path.
    if (this.isMember(playerId)) {
      return { kind: "already", attendeeCount: this.memberCount(), capacity };
    }
    // Last seat already taken, as far as this room knows.
    if (this.memberCount() >= capacity) {
      return { kind: "full", attendeeCount: this.memberCount(), capacity };
    }

    // Defense in depth: the insert re-checks capacity *inside* D1, so even a
    // room that has somehow drifted cannot over-book, and `ON CONFLICT DO
    // NOTHING` makes a duplicate a no-op instead of an error. The three
    // statements go in one `batch`, which D1 runs as a single transaction.
    const results = await this.env.DB.batch<CountsRow>([
      this.env.DB.prepare(
        `INSERT INTO rsvps (event_id, player_id, created_at)
         SELECT ?1, ?2, ?3
          WHERE (SELECT COUNT(*) FROM rsvps WHERE event_id = ?1) < (SELECT capacity FROM events WHERE id = ?1)
         ON CONFLICT (event_id, player_id) DO NOTHING`,
      ).bind(eventId, playerId, nowIso()),
      this.env.DB.prepare(
        "UPDATE events SET rsvp_count = (SELECT COUNT(*) FROM rsvps WHERE event_id = ?1) WHERE id = ?1",
      ).bind(eventId),
      this.env.DB.prepare("SELECT rsvp_count, capacity FROM events WHERE id = ?1").bind(eventId),
    ]);

    const inserted = (results[0]?.meta.changes ?? 0) > 0;
    const counts = results[2]?.results?.[0];

    if (inserted) {
      this.ctx.storage.sql.exec(
        "INSERT OR REPLACE INTO members (player_id, created_at) VALUES (?, ?)",
        playerId,
        nowIso(),
      );
      return {
        kind: "created",
        attendeeCount: counts?.rsvp_count ?? this.memberCount(),
        capacity: counts?.capacity ?? capacity,
      };
    }

    // `changes === 0` means D1 disagreed with the room: either the player is
    // already in `rsvps` (a row this room never saw) or D1 is at capacity.
    // Either way the room is stale, so throw it away and rebuild from D1 — the
    // self-healing path that also covers DO storage loss and `room_key` reuse.
    const freshCapacity = await this.hydrate(eventId);
    if (this.isMember(playerId)) {
      return { kind: "already", attendeeCount: this.memberCount(), capacity: freshCapacity };
    }
    return { kind: "full", attendeeCount: this.memberCount(), capacity: freshCapacity };
  }

  // -------------------------------------------------------------- cancel --

  private async doCancel(eventId: string, playerId: string): Promise<CancelOutcome> {
    const capacity = await this.ensureHydrated(eventId);

    // Symmetric with `doRsvp`: delete, recompute the projection, read it back,
    // all in one D1 transaction. Unconditional, so it is idempotent by
    // construction — a second DELETE simply changes nothing.
    const results = await this.env.DB.batch<CountsRow>([
      this.env.DB.prepare("DELETE FROM rsvps WHERE event_id = ?1 AND player_id = ?2").bind(eventId, playerId),
      this.env.DB.prepare(
        "UPDATE events SET rsvp_count = (SELECT COUNT(*) FROM rsvps WHERE event_id = ?1) WHERE id = ?1",
      ).bind(eventId),
      this.env.DB.prepare("SELECT rsvp_count, capacity FROM events WHERE id = ?1").bind(eventId),
    ]);

    const removed = (results[0]?.meta.changes ?? 0) > 0;
    const counts = results[2]?.results?.[0];

    // Drop the local member either way: if D1 says they are not attending, the
    // room must not keep claiming a seat for them.
    this.ctx.storage.sql.exec("DELETE FROM members WHERE player_id = ?", playerId);

    return {
      kind: removed ? "cancelled" : "not_attending",
      attendeeCount: counts?.rsvp_count ?? this.memberCount(),
      capacity: counts?.capacity ?? capacity,
    };
  }
}
