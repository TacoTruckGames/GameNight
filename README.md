# Game Night

A community event board for tabletop players. Organizers post events with a fixed number of seats; players
find them, RSVP in one tap, cancel in one tap, and keep track of what they've joined. An event can never be
over-booked — not even when two people grab the last seat at the same instant.

**Hosted:** https://gamenight.tacotruckgames.com

## Run it

Requires Node ≥ 22 and pnpm (`corepack enable` gives you pnpm if you don't have it). No accounts, no Docker,
no environment variables.

```sh
pnpm install && pnpm dev        # → http://localhost:5173
```

That's the whole app: the React client, the API, the database and the per-event Durable Objects all run
locally inside Cloudflare's `workerd` runtime, exactly as they do in production. `pnpm dev` re-applies the
migrations and re-seeds the demo board every time it starts (seed dates are relative to *now*, so the "FULL"
and "one seat left" events are always there).

```sh
pnpm test                        # 340 tests, incl. the concurrency proofs (~3 s)
pnpm stress [url] [--players 40] [--capacity 5]   # real-HTTP race against a running server
pnpm typecheck
```

The first screen has a tab per role. **Player** (Alice, Bob, …) browses and RSVPs; **Organizer**
(Cardboard Castle Games, Metro Meetup Crew, …) posts events and sees attendee lists. On either tab, pick someone
who already exists or type a name to join as somebody new, then press **Join as Player** / **Join as
Organizer** — so a reviewer can see both halves of the product without editing a database. Operator tools
are not on this screen at all: they live at **/admin**, typed — see "Administration" below.
The seed is a board with some weather in it: **64 events and 28 players** — 50 upcoming over the next five
weeks, 8 finished, 6 cancelled. The days are deliberately uneven, because a real community board is: a
two-day "Game Fest" weekend carries 4 and 5 events at one venue, a league-finals night carries 4, several
days carry one, and plenty carry none, so the month calendar has texture and a day cell has something to
drill into. Fill levels are spread the same way — empty, one seat left, FULL, and everything between — and
the fixtures the demo leans on are always there: **Commander Pod Night** is full (4/4), **D&D One-Shot** has
a single seat left (4/5, and Alice isn't in it, which makes it the hand-run race demo), past events are
hidden from the board but not from the admin list, and Alice holds a seat on a **cancelled** event so "My
events" shows what that looks like. 64 rows is also one past the admin list's 50-row page, so pagination is
exercised on a fresh database. Start times are written as **US Pacific evenings** (6-11 PM), because that is
where the venues and the audience are — which means their UTC dates run a day ahead, and a reader in another
zone sees them shifted. The seed file says so at length, so nobody “fixes” it back.

## How it works

```
 phone / laptop
   React + Vite SPA  ──HTTP /api/*──▶  Cloudflare Worker (Hono, TypeScript)
                                           │  reads: list / detail / my events / attendees
                                           ▼
                                        D1 (SQLite)  ◀── write-through ──┐
                                           ▲                             │
                                           │  writes: RSVP / cancel      │
                                           └──▶  EventRoom Durable Object (one per event)
```

One Worker serves the static client and the JSON API from the same origin. **D1** is the system of record
and answers every read. **Every RSVP and cancel is routed through a Durable Object keyed by the event**
(`EventRoom`), which is the single writer for that event's seats and writes through to D1 in one atomic
batch. Reads never touch a Durable Object.

```
worker/          Hono app, routes, auth middleware, D1 queries, the EventRoom DO
shared/          zod schemas + API types, imported by both worker and client
src/             React client (pages, components, hooks, theme tokens)
migrations/      D1 schema        seed/   demo board (idempotent SQL)
test/            vitest, runs inside workerd against real local D1 + DOs
scripts/         local db reset, stress test, deploy
```

## Design decisions

### Identity and roles

No real authentication — the brief allows a "who am I" picker. The client sends `X-User-Id`; the server
resolves it to a user row and its role on every request, and every route declares who may call it:

| Route | Player | Organizer |
|---|---|---|
| `GET /api/events`, `GET /api/events/:id`, `GET /api/users` | ✓ | ✓ (anonymous too) |
| `POST /api/users` (the caller names the role; defaults to player) | ✓ | ✓ (anonymous too) |
| `PUT` / `DELETE /api/events/:id/rsvp`, `GET /api/me/rsvps` | ✓ | 403 |
| `POST /api/events`, `GET /api/me/hosted` | 403 | ✓ |
| `GET /api/events/:id/attendees` | 403 | ✓ only for the owner |

An unknown `X-User-Id` is a 401 everywhere, which the client treats as "your stored identity is gone — pick
again". Errors are always `{ error: { code, message, details? } }`; validation failures list every bad field
with a path the form maps straight onto its inputs.

Signup lets the caller choose the role, which in a real product would be indefensible. It is deliberate here:
the picker already signs anyone in as a seeded organizer, so there is no privilege boundary to protect — only
a demo board to get into, from a phone, without seeding a database first. The part that *is* load-bearing is
unchanged and tested: what each role may do is decided server-side on every route, and the table above is
enforced, not advisory.

### Never over-booking (S1) and never double-counting (S2)

Two layers, deliberately.

1. **The Durable Object is the linearization point.** All RSVP/cancel calls for one event go through one
   `EventRoom` instance, whose methods run behind a promise-chain mutex. It keeps the event's capacity and
   member set in its own SQLite storage; a duplicate RSVP is answered from there without touching the
   database, and a full event is refused the same way. The mutex matters because the DO awaits D1 in the
   middle of a mutation, and Durable Object input gates only protect *storage* awaits — without it two
   `rsvp()` calls could interleave around the D1 round-trip. (`blockConcurrencyWhile` was rejected: a throw
   inside it resets the object, so a transient D1 error would drop the room, and it has a 30 s ceiling.)
2. **The D1 write is a guarded insert in one transaction**, so the database itself cannot over-book even if
   a DO were lost, replaced or bypassed:
   ```sql
   INSERT INTO rsvps (event_id, player_id, created_at) SELECT ?1, ?2, ?3
     WHERE (SELECT COUNT(*) FROM rsvps WHERE event_id = ?1) < (SELECT capacity FROM events WHERE id = ?1)
     ON CONFLICT (event_id, player_id) DO NOTHING;
   UPDATE events SET rsvp_count = (SELECT COUNT(*) FROM rsvps WHERE event_id = ?1) WHERE id = ?1;
   SELECT rsvp_count, capacity FROM events WHERE id = ?1;
   ```
   `PRIMARY KEY (event_id, player_id)` is S2 at the schema level; a `CHECK (rsvp_count <= capacity)` is a
   third net underneath. If D1 ever reports `changes = 0` where the room expected an insert, the room knows
   it is stale, throws its state away and rehydrates from D1 — that is also how a brand-new room learns
   about SQL-seeded RSVPs, and how it recovers from storage loss.

Why the DO when the guarded insert alone is correct? Measured, not argued: with the mutex, 25 simultaneous
RSVPs for 5 seats cost 6 D1 batches (1 hydrate + 5 inserts); without it, 13 plus a resync per loser. The
DO isolates each event's write spike from every other event, answers retries for free, and is where a
waitlist or a live seat-count push would live later — with nothing to rewrite.

`PUT` is used for RSVP because the operation is idempotent by contract, which is what lets the client retry
it on a network failure. Cancel is a hard delete; there is no RSVP history (noted under "before real
traffic").

### Counts and freshness (S3)

`events.rsvp_count` is a write-through projection: it is recomputed from the `rsvps` rows inside the same
atomic D1 batch that inserts or deletes an RSVP, so it cannot drift. Every read (list, detail, my events,
attendees) reads that column straight from D1 with no server-side cache — a count is exact as of the moment
the query ran. The only staleness is client-side: the list is considered fresh for 10 seconds and is
refetched on navigation, on window focus, and after every RSVP or cancel. A count you see is therefore at
most ~10 s old, and the RSVP button is never trusted — the server's 201/200/409 is authoritative, and a 409
("just filled up") refreshes the card immediately. There are no optimistic updates on purpose: an RSVP is
precisely the operation the server may refuse, and showing someone a seat they don't have is worse than a
half-second spinner.

### Other calls the brief left open

- **The event list is user-independent** (`GET /api/events` carries no "am I in it" flag; the client joins
  that from `/api/me/rsvps`). That is what makes the hot path cacheable later.
- **Timestamps** are stored and transmitted as UTC ISO-8601 at second precision and displayed in the
  browser's local zone. Past events are hidden from the board and refuse RSVPs (`409 EVENT_STARTED`).
- **Game type** is a small fixed enum (Magic Draft, Commander, D&D, Board games, Warhammer, Other),
  validated by zod, not by a DB constraint, so adding one is a code change rather than a migration. The
  board's filter is a native `<select>` — chips wrapped to two rows on a phone and pushed the first card
  below the fold — and it offers all but "Board games", a real tag that is simply too broad to filter on.
- **Search** is a case-insensitive `LIKE` over title and location plus the game-type filter — correct at
  50 events and at 5,000; full-text search would be gold-plating.
- **Description** (`events.description`, nullable, 500 characters, optional) is the half-paragraph a title
  cannot hold: which edition, whose decks, whether a beginner is welcome, where the door is after 7 PM.
  Three decisions about it. It is **detail-only** — the board is ~50 cards and this is its one open-ended
  field, so shipping 50 × 500 characters to render prose no card has room for would be most of the payload
  for none of the value; `EventSummary` deliberately has no `description`, and both detail routes add it
  from the row. It is **nullable, and "none" is ordinary** — most events need no explanation, and a blank
  textarea normalises to `undefined` and stores NULL, because `''` in the column would render as an empty
  paragraph and read as a deliberate blank. And because the admin patch schema is the create schema
  `.partial()`, absent already means "leave it alone", so **clearing is an explicit `null`** — the same
  convention `placeId` uses to unlink a venue. Search still covers title, location and verified address
  only: those are what a player scans a board for.
- **Sort** (`?sort=`) is `date` (soonest first, the default) or `popular`: fullest-first by *ratio* of seats
  taken, so a 3-of-4 table outranks a 4-of-8 one, tie-broken by start time. Full tables sort last under
  `popular` — they are the most popular of all, but the top of the board should be seats you can still take.
  Both orderings end in `e.id`, so the order is total and a refresh never reshuffles equal rows.
- **Agenda headers.** Under the default `date` sort the board groups cards by *local* day ("Fri, Sep 18 ·
  3 events"); `popular` stays flat because a rank has no day boundaries. Grouping is a client-side pass over
  the same list keyed by an `Intl`-derived local day, never by the UTC string — a 7 PM Pacific table must not
  land under Saturday.
- **Calendar view** is the same `GET /api/events`, no new endpoint — asked a different question. A month
  grid has to fill the days *behind* today, so calendar view sends a **date window**, `?from=&to=`,
  half-open and covering exactly the month on screen; the list sends neither and keeps the endpoint's
  upcoming-only default, which is both the cacheable one and the honest one for a view whose job is "find a
  table you can still join". A window rather than an `includePast` flag: past-inclusive with
  `ORDER BY starts_at` would come back oldest-first and could spend the 200-row cap before reaching anything
  joinable, whereas a window is bounded by construction. Both ends or neither — half a window is a 400, not
  a guess. Same search and type filters, same cap, and cancelled events stay off the board in both modes.
  The two ends are computed in *local* time and sent as UTC, because the grid buckets by local day. Month
  grid, Monday-first so the weekend sits together, a count per day, tap a day to get the ordinary cards
  beneath — the card stays the RSVP surface because a title does not fit a phone-width cell. Past days list
  normally, with the RSVP button reading "Started". Day cells are plain labelled buttons (empty days
  disabled), not an ARIA grid, because a list of buttons is correct with zero focus-management code. Sort is
  hidden in this view; the grid is chronological by construction.
- **No pagination** (`LIMIT 200`); ~50 live events fit on one screen.
- **RSVP lives on the card**, not behind the detail page: the primary user is on a phone on a commute, so the
  decision happens where the information is.
- Validation runs twice on purpose — the shared zod schema in the browser to skip a round-trip, and the same
  schema on the server, which is the one that counts.

### Venues and maps

A player has to physically get to the table, so an organizer can attach a **real venue** when posting and
players get a mini map and one-tap navigation. Four things about it are deliberate.

**`location` is still a plain, required string, and the place is separate.** Google knows the building; the
organizer knows the room. "Central Library, Room 2B" is the label a human reads, `1000 4th Ave, Seattle, WA
98104` is the canonical address, and both are searchable — `?q=4th Ave` finds that event even though the
label never says "4th Ave". Editing the label keeps the venue link; only emptying the field, choosing "Use
what I typed", or pressing Remove drops it. There is no venue *name* column because `displayName` is a
Pro-tier Place Details field: asking for it would triple the price per lookup and halve the free tier, to
store a string the organizer already typed.

**The client sends only a place id; the server resolves it.** The address and coordinates come from the
Worker's own Place Details call, so a forged latitude is not a thing that exists. The browser never talks to
Google at all — autocomplete and the map image are both proxied — which keeps the key a Worker secret, keeps
the SPA's zero-cross-origin-requests property, and means a future CSP needs no allowlist entry.

**It degrades, always.** With no `GOOGLE_MAPS_API_KEY` configured — which is what you get cloning this repo —
the typeahead is an ordinary text input, there is no mini map, and the address deep-links still work, because
Maps URLs are free and need no key. If Google is down or over budget when an event is posted, the event still
posts with the address as typed; a venue lookup is an enhancement, never a gate. The one deliberate exception
is the **admin** edit, which fails loudly with a 503: an operator re-pointing a venue is doing only that, and
telling them "saved" when nothing changed is a lie in an operator tool.

**What it costs, and why it is ~$0.** Free tier is 10,000 calls/month per Essentials SKU; beyond that
autocomplete is $2.83/1k, Place Details Essentials $5.00/1k and Static Maps $2.00/1k (0–100K band). A month
of 1,000 posted events is roughly 3,000 autocomplete + 1,000 details + a few thousand cached map renders —
inside the free tier, and about $13.50 per 1,000 events past it. The mini map is on the detail page only and
is keyed by **event id**, not by coordinates: a `?lat=&lng=` image route would be an open proxy where every
invented coordinate is a fresh billed render. Renders are cached in the Cloudflare Cache API (not R2 — the
image is regenerable for a fifth of a cent, so durability buys nothing a per-colo cache does not). A daily
per-SKU counter in D1 (`api_usage`) is a hard ceiling that a code bug cannot bypass, and it fails closed.
And the real cost lever is the **300 ms debounce**, not the session token: with an Essentials termination
Google still bills the first 12 autocomplete requests of a session, so the token only pays off past ~4.2
requests per session and a debounced session lands near 3.

Demo data note: the seeded venues are **real public civic facilities** (library branches, a community centre,
a park) so the map links resolve; the events, organizers and people are invented, and no real private
business is implied to be hosting anything. The seeded place ids are obvious placeholders rather than
fabricated Google-shaped ids, and the link builder drops them rather than asking Maps to disambiguate against
an id Google never issued.

### Look and feel

The palette is derived from the public design tokens on company.wizards.com (accent `#6E64DA`, indigo
`#290D4A`) — inspiration only, no WotC marks are used or imitated. The header is a dark brand band so the
product has an anchor, and everything below it is light because that is what long lists of events are
readable on. Every colour is a token in `src/theme/tokens.css` with a full dark-mode set, and
`node tools/contrast-audit.mjs` reads those tokens back and exits non-zero unless every text pair clears
4.5:1 and the focus ring clears 3:1, in both themes. The logo, the nine icons and the identity-screen background were
generated with Gemini via `tools/artgen/gen.py`; icons ship as alpha masks painted with `currentColor`, so
they inherit text colour and theme for free. That is the whole of it — the brief says polish earns no
credit, so this stays deliberately minimal.

### Administration

`/admin` is the operator's entry point, and it is reached **only by typing that URL** — the main site has no
tab, link or redirect into it, and the identity picker offers no admin role. Landing there without an
operator identity gives you the door (`AdminGate`): continue as one of the seeded operator accounts
(*Site Admin*). Every operator page wears a fixed **orange bar** — the same colour in both themes, since
"am I about to change live data?" should not depend on noticing a tint — and the admin site has its own
shell, without the app's bottom tabs. It is small on
purpose: an overview (counts, 14-day signups and RSVPs, open errors, recent admin actions), **Users**
(search/filter, suspend with an optional reason, unsuspend), **Events** (every event, past and cancelled
included; edit any field, cancel/restore, remove an attendee) and **Errors** (the backend error log).

Three rules keep it honest with the rest of the system. A suspension is one nullable `suspended_at` checked
once in the auth middleware, so every route inherits it as `403 ACCOUNT_SUSPENDED` and the client returns the
person to the picker. A capacity change **rotates the event's `room_key`**, because an already-hydrated
`EventRoom` caches capacity and would otherwise keep refusing RSVPs at the old number; removing an attendee
goes **through the room's `cancel()`** so its member set never drifts from D1; and capacity can't be set
below the current attendee count (a field error, not a constraint crash). Cancelling is a status, not a
delete — the board hides the event and refuses new RSVPs (`409 EVENT_CANCELLED`), but seat-holders still see
it, marked, in My events. Every admin mutation writes an `audit_log` row with the actor.

Backend errors: unexpected throws are `console.error`'d first (Workers Logs is the floor), then upserted
into `error_log` keyed by a fingerprint of scope + normalised message, so a hot failure loop is one row with
a count rather than a million writes; resolving an error hides it until it recurs. The overview's "Send
test error" button exercises that whole path so an operator can trust it before they need it.

## Reaching the 12-month column

The launch build already has the shape; here is exactly what changes at ~200k players / ~5k live events /
100× list reads with 10× event-day spikes:

1. **The list read path** — add a per-colo edge cache (`Cache-Control: public, s-maxage=5` + the Cache API)
   on `GET /api/events`. The list is identical for every user by design, so this is a one-line change that
   bounds staleness at ~15 s worst case and caps D1 list reads at ~0.2 QPS per colo *regardless of traffic*.
   The database does not melt because it never sees the read volume.
2. **Remaining reads** — D1 read replication (Sessions API) for detail and per-user pages; cursor pagination
   on the list; an index review once there are thousands of live events.
3. **Writes** — nothing. Each event is already its own Durable Object, so an event-day spike on one event
   contends with nothing else, and 5,000 live events are 5,000 independent single-writers.
4. **Counts** stay a write-through projection; no counters to reconcile.

## Testing

`pnpm test` runs 340 tests *inside* the Workers runtime (`@cloudflare/vitest-plugin`) against a real local
D1 and real Durable Object instances — the same code paths as production, not mocks.

| Suite | What it proves |
|---|---|
| `test/unit/schemas` | every S4 rejection: capacity `0`/`-1`/`1.5`/`501`/`"8"`, past or malformed dates, blank titles, unknown game types |
| `test/unit/event-room` | hydration from D1; the `changes = 0` self-healing path when D1 and the room disagree |
| `test/unit/calendar` | local-day keys across the UTC-midnight boundary in both directions, grouping order, month grids for Sunday- and Monday-first weeks, leap February, today marking |
| `test/api/*` | every route × every role × every error code; list ordering, filters, `%` escaping in search |
| `test/concurrency/rsvp-race` | **S1:** 25 simultaneous RSVPs for 1 seat and for 5 seats → exactly `capacity` × 201, the rest 409, and `rsvps` rows == `rsvp_count` == DO members == capacity; then a cancel frees exactly one seat |
| `test/concurrency/rsvp-idempotent` | **S2:** one player firing 10 identical RSVPs at once → one 201, nine 200s, one row; 10 concurrent cancels → all 200, zero rows; a mixed RSVP/cancel storm ends consistent |
| `test/concurrency/hydration` | a full event seeded straight into SQL, never touched by a DO → the first RSVP is correctly refused |

The race tests were checked for vacuity: with instrumentation on the mutex, all 25 requests were observed
queued inside the room simultaneously, and the suite was run five times back to back without a flake.

`pnpm stress` is the real-HTTP proof: it creates a throw-away event and N players, fires N concurrent
`PUT`s, and exits non-zero if the final count ever exceeds capacity. Removing the capacity guards makes it
fail, as it should. Run it against the hosted URL:

```sh
pnpm stress https://gamenight.tacotruckgames.com --players 40 --capacity 5
```

To see the race by hand: open the app in two browser profiles, pick two different players, and press RSVP
on the D&D One-Shot (one seat left) in both — one gets in, the other sees "just filled up".

## Time spent

Roughly **3–4 hours** end to end, in one sitting on 2026-09-15:

| Where | ~Time |
|---|---|
| Reading the brief, choosing the stack, designing the DO/D1 write path and the test matrix | 1 h |
| Backend, Durable Object, tests, stress script | 1 h |
| React client | 45 min (in parallel with the above) |
| Integration, verification, deploy, README | 45 min |

## How it was built

With Claude Code. I wrote the plan with the model (stack, schema, the exact RSVP SQL, the DO mutex design,
the freshness statement, the test matrix) and reviewed it before any code existed; implementation agents
then built the worker, the tests and the client from that plan in parallel, and a final pass integrated
them. Everything here I can defend line by line, because the parts that matter were verified rather than
trusted:

- every S1/S2 claim above is backed by a test I read, and the tests were checked for vacuity (see Testing);
- the Durable Object semantics the design leans on (synchronous `sql.exec`, input gates opening on a D1
  await, `blockConcurrencyWhile` resetting on throw) were cross-checked against Cloudflare's documentation
  and then exercised by the concurrency suite;
- every route was hit over real HTTP with `curl` for each status code, and the stress script was run
  against both the local server and the hosted deployment;
- the logo, icons and background are generated by `tools/artgen/gen.py` (Gemini REST + a chroma key), so the
  art is reproducible from a prompt rather than a pile of binaries of unknown origin;
- `tools/contrast-audit.mjs` reads the real token values out of `tokens.css` and checks every text/background
  pair in both themes, so the palette claim above is measured, not eyeballed.

## Before real traffic

What is stubbed or simplified, roughly in the order I would harden it:

1. **Auth.** `X-User-Id` is trust-the-client, anyone can mint an organizer account from the picker, and the
   admin is just another name on it — all fine for a demo board, none of it survives contact with real
   users. Replace with real sessions (OAuth + signed cookie), put Cloudflare Access or an email allowlist in
   front of `/admin` and `/api/admin/*`, and make organizer and admin roles something granted rather than
   self-declared; rate-limit `POST /api/users`; add body-size limits, write rate limits and CSP headers.
   The `error_log` and `audit_log` tables need a retention job (anonymise, then purge).
2. **Durable Object trade-offs.** A room lives in one location, so RSVP latency is higher for far-away
   players (reads are unaffected). Storage loss is recovered by lazy rehydration from D1, but a periodic
   reconcile alarm that re-derives members from D1 and logs discrepancies would make the DO/D1 divergence
   window observable rather than merely self-healing.
3. **Read scaling** as described above: list edge cache, read replication, pagination.
4. **Event lifecycle.** No edit / cancel-event / capacity change, no waitlist, no RSVP history (cancel is a
   hard delete), organizers cannot be created through the UI.
5. **Observability.** Workers Logs is on; add request ids, structured logs around the DO write path,
   error-rate alerts, and a D1 Time Travel restore drill.
6. **CI and browser tests.** `pnpm typecheck && pnpm test` on every push, plus a Playwright smoke of the
   three player flows; the client was verified over HTTP and by hand, not by an automated browser.
7. **Maps.** Set per-SKU daily quota caps in the Google console and a billing budget alert — the in-repo
   `api_usage` ceiling is the braces, the console is the belt. Refresh stale `place_resolved_at` rows
   periodically, since place ids and addresses drift. Note that autocomplete sends the organizer's coarse
   Cloudflare edge location to Google as a relevance bias; say so in a privacy note before real users. The
   map route's success path (upstream fetch → cache write) is the one branch only a live key exercises.

## Deploying

```sh
cp .env.example .env             # CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
pnpm run deploy                  # typecheck → build → remote D1 migrations → wrangler deploy
pnpm db:seed:remote              # load the demo board (also resets it after a stress run)
```

The Worker, its D1 binding, the `EventRoom` Durable Object and the custom domain are all declared in
`wrangler.toml`; the first deploy creates the DO class and the DNS record. `.env` is only ever read by the
deploy script and is never bundled: the Vite/Vitest configs set `CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false`
so wrangler does not mistake deploy credentials for Worker dev vars.
