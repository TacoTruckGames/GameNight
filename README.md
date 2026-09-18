# Game Night

A community event board for tabletop players. Organizers post events with a fixed number of seats; players
find them, RSVP in one tap, cancel in one tap, and view RSVPs.

**Hosted:** https://gamenight.tacotruckgames.com

## Run it

Requires Node ≥ 22.18 and pnpm (`corepack enable`). No accounts, no Docker, no environment variables.

```sh
# http://localhost:5173
pnpm install && pnpm dev
```

Everything runs locallys (React client, API, database and the per-event Durable Objects) inside
Cloudflare's `workerd`, exactly as in production. `pnpm dev` re-applies the migrations and re-seeds the
demo board on every start; seed dates are relative to _now_, so the fixtures are always there.

Additionally, you can run the tests and validation:

```sh
# 433 tests inside the Workers runtime, incl. the concurrency proofs (~4 s)
pnpm test

# tsc on all three projects; ESLint (type-aware) + Prettier --check
pnpm typecheck && pnpm lint

# real-HTTP race for the last seat against a running server (defaults to local server)
pnpm stress
```

The first screen has a tab per role. **Player** (Alice, Bob, …) browses and RSVPs; **Organizer** (Cardboard
Castle Games, …) posts events and sees who's coming. Pick an existing person or type a name to join as
someone new.

### Mock Data Seeding

**64 events** across five weeks, 50 upcoming, 8 finished, 6 cancelled,
with deliberately uneven days and **2,000 players**, 28 named personas plus 1,972 generated in SQL, so the
board opens at launch scale offline.

## How it was built, and how long it took

Built with Claude Code over three working days plus a submission morning: about **24 hours** of session time
and 107 commits. Hours are measured from the Claude Code session logs and the commit timestamps, so they
include time the agent spent working on its own. Each feature started as a written plan, reviewed before any
code; every commit is one concern with the _why_ in its message, so `git log` is the design record.

| Day                    | Focus                                              | Time   |
| ---------------------- | -------------------------------------------------- | ------ |
| **Day 1** | Initial implementation, first features, bug fixing              | ~7 h   |
| **Day 2** | Requirements check, board and organizer features, UI polish     | ~8 h   |
| **Day 3** | performance, security analysis, UI polish, Submission review    | ~9 h   |


**Day 1 — initial implementation and bug fixing.** The plan (stack, schema, the exact RSVP SQL, the DO mutex,
the test matrix), then the whole brief in one commit: the DO/D1 write path, S1–S4, the concurrency suite and
the client. The rest of the day went beyond it: the WotC-derived look, the role-tabbed
sign-in, the admin dashboard, the agenda and month calendar, venue search with a map, the first deploy, and a
screenshot review of every flow at phone and desktop widths with the fixes it turned up.

**Day 2 — requirements check, features and UI polish.** A 64-event seed, then a second pass over the brief that produced
an exit-criteria list and two fixes (head counts, game types). Descriptions, past events that read as past,
the week view on all three lists, organizer editing, real Seattle venues through Google Places, and the
compact event card with the detail sheet that opens over the board. Sheet and desktop layout polish; organizer cancel and delete; a separate admin session.

**Day 3 — performance and security, submission review.**  The 12-month column: populate and load-test scripts, with the launch load
measured rather than estimated. A full security review and its fixes (CSP, a user picker that is not a
directory, redaction), a refactor pass that removed duplicated edit and sheet code, ESLint and Prettier in the
deploy gate, the README cut to a third, and race tests that prove they were races. A run through every command in this README, a quieter test log, the
favicon, and copy fixes.

## How it works

```
 phone / laptop
   React + Vite SPA  ──HTTP /api/*──▶  Cloudflare Worker (Hono, TypeScript)
                                           │  reads: list / detail / my RSVPs / attendees
                                           ▼
                                        D1 (SQLite)  ◀── write-through ──┐
                                           ▲                             │
                                           │  writes: RSVP / cancel      │
                                           └──▶  EventRoom Durable Object (one per event)
```

One Worker serves the static client and the JSON API from one origin. **D1** is the system of record and
answers every read. **Every RSVP and cancel goes through a Durable Object keyed by the event** (`EventRoom`),
the single writer for that event's seats, which writes through to D1 in one atomic batch. Reads never touch
a Durable Object.

```
worker/     Hono app: routes/, middleware/ (auth), lib/, db/ (D1 queries), do/ (the EventRoom DO)
shared/     zod schemas + API types, imported by both sides
src/        React client: pages/, components/, api/ (query hooks), identity/, admin/ (operator site), theme/
migrations/ D1 schema             seed/      demo board (idempotent SQL)
test/       vitest inside workerd against real local D1 + DOs
scripts/    db-reset-local, deploy, stress, populate (to launch scale), loadtest
tools/      contrast-audit (both themes), artgen (icon generator)
public/     static assets and _headers (the SPA's security headers)
worker-configuration.d.ts   generated by `pnpm cf-typegen`; committed so a clone typechecks — skip it
```

## Design decisions

### Identity and roles

No real authentication. The brief allows a "who am I" picker. The client sends `X-User-Id`; the server
resolves it to a user and a role on every request, and every route declares who may call it:

| Route                                                                                                     | Player | Organizer            |
| --------------------------------------------------------------------------------------------------------- | ------ | -------------------- |
| `GET /api/events`, `/api/events/:id`, `/api/users` (bounded: `?role=&limit=`, 50 by default)              | ✓      | ✓ (anonymous too)    |
| `POST /api/users` — the caller names the role; `admin` is refused                                         | ✓      | ✓ (anonymous too)    |
| `PUT` / `DELETE /api/events/:id/rsvp`, `GET /api/me/rsvps`                                                | ✓      | 403                  |
| `POST /api/events`, `GET /api/me/hosted`                                                                  | 403    | ✓                    |
| `PATCH` / `DELETE /api/events/:id`, `POST …/cancel`, `GET …/attendees`                                    | 403    | ✓ only for the owner |
| `GET /api/places/*` — config and the event map are public; suggest and the preview map are organizer-only |        |                      |
| `/api/admin/*` — 15 routes, every one behind `requireAdmin`                                               | 403    | 403                  |

An unknown id is a 401 everywhere and the client returns you to the picker. Errors are always
`{ error: { code, message, details? } }`; validation failures list every bad field with a path the form maps
onto its inputs. Signup letting the caller choose a role would be indefensible in a real product; here there
is no privilege boundary to protect, only a demo board to get into and what each role may _do_ is enforced
server-side on every route, and tested.

### Never over-booking (S1), never double-counting (S2)

Two layers, deliberately.

1. **The Durable Object is the linearization point.** Every RSVP and cancel for one event runs through one
   `EventRoom`, behind a promise-chain mutex (input gates only protect _storage_ awaits, and the room awaits
   D1 mid-mutation). It keeps capacity and the member set in its own SQLite; a duplicate RSVP and a full
   table are both answered from memory without touching D1.
2. **The D1 write is a guarded insert in one transaction**, so the database cannot over-book even if a room
   is lost, replaced or bypassed:
   ```sql
   INSERT INTO rsvps (event_id, player_id, created_at) SELECT ?1, ?2, ?3
     WHERE (SELECT COUNT(*) FROM rsvps WHERE event_id = ?1) < (SELECT capacity FROM events WHERE id = ?1)
     ON CONFLICT (event_id, player_id) DO NOTHING;
   UPDATE events SET rsvp_count = (SELECT COUNT(*) FROM rsvps WHERE event_id = ?1) WHERE id = ?1;
   ```
   `PRIMARY KEY (event_id, player_id)` is S2 at the schema level; `CHECK (rsvp_count <= capacity)` is a third
   net. If D1 reports `changes = 0` where the room expected an insert, the room throws its state away and
   rehydrates, which is also how a new room learns about SQL-seeded RSVPs.

### Why the DO when the guarded insert alone is correct?

Measured: with the mutex, 25 simultaneous RSVPs for 5
seats cost 6 D1 batches; without it, 13 plus a resync per loser. The room isolates each event's write spike
from every other event and answers retries for free. `PUT` for RSVP because it is idempotent by contract,
which is what lets the client retry on a network failure.

### Counts and freshness (S3)

`events.rsvp_count` is recomputed inside the same batch that inserts or deletes the RSVP, so it cannot drift,
and every read takes it straight from D1. The only staleness is client-side: lists are fresh for 10s and
refetch on focus and after every write, so a count you see is at most ~10s old. The server's 201/200/409 is
the only truth, no optimistic updates, because an RSVP is precisely the operation the server may refuse,
and a 409 ("just filled up") refreshes the card on the spot.

### The board and the sheet

- **The event list is user-independent** — no "am I in it" flag; the client joins that from `/api/me/rsvps`.
  That is what makes the hot path cacheable later.
- **Week / Month / List** are three readings of one `GET /api/events`. The dated views send a half-open
  `?from=&to=` window covering exactly the span on screen (both ends or neither — half a window is a 400);
  List keeps the upcoming-only default. Days group by _local_ day, never by the UTC string. Nothing is
  selected on arrival: the pane shows the whole span, and a day cell is a filter you can press again to
  remove. Past days list greyed with an "Ended" chip and no action. At ≥1120px the calendar becomes the
  right-hand column, the cards the left.
- **Timestamps** are UTC ISO-8601 at second precision, displayed in the browser's zone. Past events are
  hidden from the board and refuse RSVPs (`409 EVENT_STARTED`).
- **Game type** is a category of night — Card games, Board games, RPG, Miniatures, Other — validated by zod,
  not a DB constraint. The specific game belongs in the title; text search finds it.
- **Search** is a case-insensitive `LIKE` over title, location and verified address. **Sort** on the API is
  `date` or `popular` (fullest-first by ratio, full tables last); the board itself is always soonest-first.
  `LIMIT 200`, no pagination — fifty live events fit on a screen.
- **Validation runs twice** — the shared zod schema in the browser to skip a round-trip, and on the server,
  which is the one that counts.

### Administration

`/admin` is reached only by typing it, signs itself in as the one provisioned operator account. Every page wears a fixed orange bar. This was added to maintain and validate the mock data.

## Reaching the 12-month column

The brief's table, launch **measured** on production, 12 months **designed**:

| Dimension            | Launch (measured)                                  | 12 months (designed for)                        |
| -------------------- | -------------------------------------------------- | ----------------------------------------------- |
| Players (registered) | **2,000** — seeded, and on the live board          | ~200,000                                        |
| Events live at once  | 50 upcoming (64 total)                             | ~5,000                                          |
| Traffic shape        | 16,611 requests, 0 errors, p50 36–77 ms            | read-heavy ~50:1; 10× event-day spikes          |
| Hot path             | list with live counts: 251 rps at c=20, p95 102 ms | same list at ~100× — must not melt the database |

**Launch, measured** (`pnpm populate`, `pnpm loadtest`, `pnpm stress`; all zero-dependency):

| What                                           | Result on production                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------- |
| Signup — 1,932 `POST /api/users`, 12 in flight | 12.1 s, **160 signups/s**, p50 72 · p95 109 · p99 188 ms, every one a 201 |
| List `GET /api/events`, c=20                   | **251 rps**, p50 77 · p95 102 · p99 173 ms, 20.4 KB, 0 errors             |
| Calendar / Detail / Mine, c=10                 | 225 / 258 / 147 rps, p95 63 / 59 / 107 ms                                 |
| Spike — the list at c=100                      | **328 rps**, p50 304 · p99 549 ms, 0 errors                               |
| Race — 40 players, 5 seats (production)        | exactly 5 × 201, 35 × 409 `EVENT_FULL`, 951 ms; 20 retries all idempotent |
| Race — 300 players, 16 seats (local workerd)   | exactly 16 × 201, 284 × 409, **588 ms**                                   |

D1's own accounting: the list query reads **144 rows in 0.68 ms**, detail 2 rows in 0.31 ms. Every read is one
indexed statement and **no read ever does a `COUNT(*)`**. Two honest notes: the spike's 304 ms p50 is the
harness (one laptop plateaued at ~330 rps; 100 in flight ÷ 330 rps is 300 ms by Little's law), not the
server, whose ceiling this did not find; and populating to 2,000 found `GET /api/users` unbounded — 170 KB
and a 2,001-option select — which is why it is bounded now.

**Why it holds at launch.** One Worker is the whole backend. D1 answers every read with one indexed query,
and `rsvp_count` is a column, not a join. A Durable Object per event is the single writer for exactly the
rows that can conflict: the 284 losers of a 300-way race are refused from memory and never touch D1.

**What changes for 12 months** — nothing is rewritten, and the write path changes nothing:

- **200,000 players:** nothing structural (~50 MB); the picker is replaced by real sessions, which is first
  on the hardening list anyway.
- **5,000 live events:** `LIMIT 200` becomes cursor pagination on `(starts_at, id)`, already indexed; the
  calendar is windowed today. FTS5 only if search matters.
- **~100× reads:** **edge-cache the anonymous list** — it is identical for every user by design, so
  `Cache-Control: public, s-maxage=5, stale-while-revalidate=30` at every colo means D1 sees at most one
  list query per five seconds per colo per query string, bounded by geography rather than traffic. Counts
  become ≤ 5 s stale at the edge; the RSVP answer stays authoritative. The 1-in-50 per-user reads go to D1
  read replicas with a bookmark after an RSVP.
- **10× spikes:** writes land on a handful of rooms, each serialising only its own event (~500 decisions/s
  measured, winners only reaching D1); 5,000 events are 5,000 independent single-writers. The trade is that a
  room lives in one place, so a far player pays ~100–200 ms on the RSVP itself — right for an action taken
  once per event.

**Why this stack:** Workers because client and API deploy as one unit with nothing to operate; D1 because the
data is relational and small and wants transactions and point-in-time restore; Durable Objects because the
last seat is a single-writer problem and a DO is a single writer you can address by key; shared zod schemas
so browser and server can never disagree; TanStack Query so "how stale may a count be" lives in one place.
**What stays the same:** no sharding (the event id already is the shard), no queue, no counter service, no
optimistic updates. Order of work if the traffic arrives: list cache, sessions, read replicas, pagination,
then observability.

## Testing

`pnpm test` runs 433 tests _inside_ the Workers runtime against real local D1 and Durable Objects — the same
code paths as production, not mocks.

| Suite                              | What it proves                                                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `test/unit/schemas`                | every S4 rejection: capacity `0`/`-1`/`1.5`/`501`/`"8"`, bad dates, blank titles, unknown game types     |
| `test/unit/event-room`, `calendar` | hydration and the `changes = 0` self-heal; local-day keys across UTC midnight, month/week grids, DST     |
| `test/api/*`                       | every route × every role × every error code; filters, windows, escaping; the security headers and limits |
| `test/concurrency/rsvp-race`       | **S1:** 25 simultaneous RSVPs for 1 and 5 seats → exactly `capacity` × 201; rows == count == members     |
| `test/concurrency/rsvp-idempotent` | **S2:** 10 identical RSVPs → one 201, nine 200s, one row; a mixed RSVP/cancel storm ends consistent      |
| `test/concurrency/hydration`       | a full event seeded straight into SQL → the first RSVP is correctly refused                              |

The race tests prove they were races: the room counts how many calls are inside its mutex at once, and the
suite asserts the peak was ≥ 2 — sequential delivery would pass every tally and prove nothing. The brief's
literal case, two players and one seat, holds the mutex shut until both requests are queued behind it, then
releases. `pnpm stress`
is the real-HTTP proof; removing the capacity guards makes it fail. To see the race by hand, open two browser
profiles and press RSVP on the D&D One-Shot in both.

```sh
pnpm stress   https://gamenight.tacotruckgames.com --players 40 --capacity 5
pnpm populate https://gamenight.tacotruckgames.com --players 2000     # tops a smaller board up to a target, through the signup API
pnpm loadtest https://gamenight.tacotruckgames.com --seconds 15 --budget 20000
```

## What is beyond the brief

The brief says keep the scope small, and about three quarters of the time went past its seven stories. None
of it touches the write path — S1–S4 are the same code and tests they were at hour four.

- **Admin dashboard** — production instincts means someone can suspend an account, fix an event and see the
  error log without a database console.
- **Calendar, week agenda, sheets** — with fifty live events a flat list stops answering "what's on this
  Saturday"; the calendar reuses the same endpoint with a date window.
- **Venues** — an address a phone can navigate to is the difference between a listing and an event you
  attend; keyless-safe, cost-capped.
- **Organizer editing, cancel, delete** — "post it and live with it" is not a product.
- **Scale measurement** — the launch column populated and loaded on production, so the 12-month answer is
  argued from numbers.

## Before real traffic

1. **Auth.** `X-User-Id` is trust-the-client; anyone can mint an organizer, and anyone who types `/admin` is
   the operator. Replace with real sessions, put Cloudflare Access in front of `/admin`, make roles granted;
   rate-limit `POST /api/users` and `/api/places/*` (the Google spend ceiling, ~$12/day, is reachable by any
   self-declared organizer). Disable the `*.workers.dev` origin — needs a deploy token with Workers Routes:
   Read or a dashboard toggle; `wrangler.toml` says why it is still on. Retention for `error_log`/`audit_log`.
2. **Durable Objects.** A room lives in one location; a periodic reconcile alarm would make the DO/D1
   divergence window observable rather than merely self-healing.
3. **Read scaling** — list edge cache, read replicas, cursor pagination, in that order (see above).
4. **Event lifecycle.** No waitlist, no RSVP history, and nothing tells seat-holders that a night moved.
5. **Observability.** Request ids, structured logs around the DO write path, alerts, a Time Travel drill.
6. **CI and browser tests.** Typecheck, lint and tests on every push, plus a committed Playwright smoke.
7. **Maps.** Per-SKU quota caps and a budget alert in the Google console; refresh stale `place_resolved_at`
   rows; a privacy note that autocomplete sends the organizer's coarse edge location to Google as a bias.
