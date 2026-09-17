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
pnpm test                        # 399 tests, incl. the concurrency proofs (~3 s)
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
                                           │  reads: list / detail / my RSVPs / attendees
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
| `PATCH /api/events/:id`, `GET /api/events/:id/attendees` | 403 | ✓ only for the owner |

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
atomic D1 batch that inserts or deletes an RSVP, so it cannot drift. Every read (list, detail, my RSVPs,
attendees) reads that column straight from D1 with no server-side cache — a count is exact as of the moment
the query ran. The only staleness is client-side: the list is considered fresh for 10 seconds and is
refetched on navigation, on window focus, and after every RSVP or cancel. A count you see is therefore at
most ~10 s old, and the RSVP button is never trusted — the server's 201/200/409 is authoritative, and a 409
("just filled up") refreshes the card immediately. There are no optimistic updates on purpose: an RSVP is
precisely the operation the server may refuse, and showing someone a seat they don't have is worse than a
half-second spinner.

### Other calls the brief left open

- **The event list is user-independent** (`GET /api/events` carries no "am I in it" flag; the client joins
  that from `/api/me/rsvps`). That is what makes the hot path cacheable later. `GET /api/me/rsvps` and
  `GET /api/me/hosted` take the same optional `?from=&to=` window as the board — both ends or neither — and
  without it they stay upcoming-only, exactly as they were.
- **Timestamps** are stored and transmitted as UTC ISO-8601 at second precision and displayed in the
  browser's local zone. Past events are hidden from the board and refuse RSVPs (`409 EVENT_STARTED`) — but
  My RSVP and the organizer's list can page back a week to see what you went to.
- **Game type** is a category of night — Card games, Board games, RPG, Miniatures, Other — not a game and
  not a format. The specific game belongs in the title ("Friday Night Draft", "Pokémon League"). The first
  cut mixed three levels (a Magic format, one specific RPG, a whole category) and had no home for a Pokémon
  league or a Pathfinder table; the two products built for exactly this job agree on the category level —
  Tabletop.Events seeds "Board Game, Card Game, Miniatures, RPG" and Warhorn offers board / card / RPG /
  miniature / other — whereas store calendars go by franchise and grow a bucket per new TCG. A metro-wide
  board that libraries and home groups post to needs buckets that hold for every organizer. The trade is a
  coarser filter; text search finds the exact game. The enum is validated by zod, not a DB constraint, so
  adding one is a code change rather than a migration, and an unknown value renders as "Other" rather than
  breaking a card.
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
  Both orderings end in `e.id`, so the order is total and a refresh never reshuffles equal rows. **The board
  no longer offers the choice**: a filter row already carrying search, game type and a three-way View switch
  had nothing left to spend on order, and soonest-first is how a listings page is read anyway. The parameter
  stays on the API, documented and tested, because the ranking is the interesting half of it.
- **Agenda headers.** The board groups cards by *local* day ("Fri, Sep 18 · 3 events") in all three views.
  Grouping is a client-side pass over the same list keyed by an `Intl`-derived local day, never by the UTC
  string — a 7 PM Pacific table must not land under Saturday.
- **Week / Month / List** are three readings of one `GET /api/events` — no second endpoint, no second
  cache, just a different question. **Week** is the default: "what can I get to in the next few days" is
  what someone opens a board with, and seven cells answer it without the scrolling thirty demand on a
  phone. **Month** steps out for planning further ahead. **List** is the plain feed.
  Both dated views have to fill the days *behind* today — a grid you cannot page backwards through is a
  broken grid — so they send a **date window**, `?from=&to=`, half-open and covering exactly the span on
  screen. List sends neither and keeps the endpoint's upcoming-only default, which is both the cacheable
  one and the honest one for a view whose job is "find a table you can still join". A window rather than an
  `includePast` flag: past-inclusive with `ORDER BY starts_at`
  would come back oldest-first and could spend the 200-row cap before reaching anything joinable, whereas a
  window is bounded by construction. Both ends or neither — half a window is a 400, not a guess. Same
  search and type filters, same cap, and cancelled events stay off the board in every mode. Every window's
  two ends are computed in *local* time and sent as UTC, because the cells bucket by local day. Monday-first
  so the weekend sits together, a count per day, tap a day to get the ordinary cards beneath — the card
  stays the RSVP surface because a title does not fit a phone-width cell. Past days list normally, greyed,
  with an "Ended" chip and no action at all — a finished night cannot be joined, and the seat you held on one
  cannot be given back, so a button there would only offer to rewrite history. **Nothing is selected on
  arrival**: the pane shows the whole span on screen, upcoming only, and a day cell is a filter you apply to
  it. Pressing the open cell takes the filter off again, so `aria-pressed` means what it says in both
  directions and the overview is always one press away. An opinionated default — today, or the first day
  with anything on it — was worse in both directions: it hid the rest of the week behind a choice the reader
  never made, and on any span behind today it opened on something already finished. Past events stay out of
  the overview for the same reason the list is upcoming-only: it is the view of what you can still act on.
  When a span holds events but every one has started, the pane says "Nothing upcoming" and points at the
  cells rather than claiming "no events", which the counts directly above it would contradict. Day cells are plain labelled
  buttons (empty days disabled), not an ARIA grid, because a list of buttons is correct with zero
  focus-management code. At ≥1120px the whole page widens and each view spends the width its own way: the
  month grid and the week strip become navigators, with the open day's cards beside them instead of beneath;
  the list keeps its days in one chronological column and pairs the cards *within* a day two across. The
  split never crosses a heading — a run of days dealt into two columns reads Monday, Wednesday, Tuesday,
  whichever direction the columns fill — but two cards under one date already share that date, so they can
  sit side by side and be read left then right.
- **Week agenda** is that same week strip on the two personal pages, `My RSVP` and the organizer's
  `Your events`, which open on it. One `WeekStrip` and one `WeekAgenda` shell serve all three pages: the
  strip is the month grid's own cells in a single row — same `.cal__day` button, same count, same
  tap-a-day-for-the-cards pane — and the personal pages ask `/api/me/rsvps` and `/api/me/hosted` the
  windowed question the board asks `/api/events`: local Monday 00:00 to the next Monday, computed in the
  reader's zone and sent as UTC, because the strip buckets by local day. Past weeks therefore show what you
  went to, greyed, with an "Ended" chip and no button — one word for the state, in one place, said by the
  component whose job that is. **List** is the
  unwindowed, upcoming-only agenda, unchanged and one tap away. Week leads because the question a personal
  agenda is opened with is "am I double-booked on Saturday?", which a flat list makes you answer by reading
  every date. An empty week says "nothing this week" rather than "you have never RSVP'd": a window cannot know
  more than the window, and a second unwindowed request on every visit to earn the stronger sentence is not
  a trade worth making — list view still says it.
- **Switching identity** hangs off the name button in the header rather than rising from the bottom of the
  screen. A sheet that arrives from somewhere else has to say where it came from, and carry a Close control
  to send it back; a panel that drops from the control you pressed needs neither — press the name again,
  press anywhere outside, or press Escape, and focus goes home to the button. Both role tabs carry the
  role's icon, and the live tab and its commit button are painted in that role's colour: **player blue**
  and **organizer green**, the same two hues the header badge uses for the same fact, so "who am I about to
  become" looks like "who am I" will. The ink on those fills is the brand near-black at 8.95:1 and 9.41:1,
  audited in both themes like every other pair.
- **Search and the type filter share one line**, and every view is chronological, so the board's chrome is
  two rows before the first event instead of four.
- **The chrome gave 27px back.** The header was 68px around a 44px control, and the tab bar 68px around two
  words; the icon sits beside its label now rather than above it, and both are padded to what their tap
  target actually needs. Every target is still exactly **44px** — the compression came out of the wrappers,
  not the things you press. Header 68 → 56, tabs 68 → 53, the View pill 54 → 50. On the week view that is
  1 card fully visible → 4.
- **No pagination** (`LIMIT 200`); ~50 live events fit on one screen.
- **An organizer's board is their own events.** The Events tab reads "Our Events" and the page "Our Upcoming
  Events", and every card links to that event's door list instead of offering a seat — because the question
  an organizer opens a board with is "who is coming to my tables". `/organize` used to answer it a second
  time, carrying a duplicate of this list under its form, so an organizer had two places to look at one
  week; that page is now the posting form and nothing else. Both list hooks are called on every render, as
  hooks must be, and each is disabled for the role it does not serve, so exactly one request goes out.
  `/api/me/hosted` takes a window and nothing else, so for an organizer the search and type filters run on
  the client — affordable precisely because that endpoint is already capped at 200 rows, which makes it a
  filter over one organizer's own events rather than over a database. A card's action is the head count and
  a person icon rather than "N seats", because the slot is 70px and the icon says the noun in less room than
  the noun does; the accessible name keeps the whole phrase. **The door list is a sheet too**, with the same
  shape as the player's — game type, date, venue, map, description — and the guest list where a player gets
  a seat. It also carries **Edit Event**, which it has to: the board's cards open this page now, so without
  it an organizer could only edit by typing the player's URL for their own event. And an open day offers
  **“+ New Event”**, which opens the form on that evening — the day was chosen by looking at it, and making
  someone retype it is the small rudeness a calendar exists to avoid.
- **RSVP lives on the card**, not behind the detail page: the primary user is on a phone on a commute, so the
  decision happens where the information is.
- **The card is 88px, and was 223px.** Measured at 390×844: 66px of the old card was padding and gaps, and
  only one card fitted the week view. The new one is a 3×3 grid — a 50px time rail, then title, seat state
  and venue — and one placement does the work: the **title spans to the right edge** with the action *below*
  it, because a button beside a title truncates the title and a button under it cannot. The action then
  costs no row of its own either, being 44px against two 13px lines. **The whole card opens the event** —
  the title's link is stretched across it, and only the RSVP button lifts itself back above. That is the
  trick this card used to refuse because it eats text selection; the reason went away when the venue stopped
  being a link, since the title truncates to one line and the full text of both is on the sheet the tap
  opens. Three things left the card: the date
  (every list already writes "Thu, Sep 17 · 2 events" directly above it), the host, and "9 going" — which
  is `capacity - seatsLeft` said a second way. All three are on the sheet. The venue stopped being a link,
  which is what freed a whole 44px tap target for a line of muted text; it is a link where there is room
  for one. Fully visible per screen, before → after: **week 1 → 3, list 2 → 5**. RSVP, Full and Cancel share
  one width, so a column of cards has a straight right edge whatever state each row is in.
- **The detail is a sheet over the board**, not a page you navigate to. Tapping a card passes
  `state.backgroundLocation`, so `routes.tsx` renders the board *and* the event on top of it; a typed URL, a
  shared link or a refresh carries no such state and gets the full page, unchanged. One element, one query,
  two frames. The URL is the event's either way, so a sheet is still a link you can send. Escape, a tap
  outside and Back all close it — the same three, and the same absence of a Close button, as the identity
  switcher. Its header is **kind, name, when, whose** — in the order the questions arrive — and it is the
  same header for a player and for the organizer of that event, because reviewing your own listing means
  reading exactly what a player reads. The date moved out of the card to get there: it used to be fifth on
  the page, below a venue and a map, and it is the second thing anyone wants. Moving it up meant shortening
  it — "Saturday, September 19, 2026 at 7:30 PM" is 39 characters and wraps on a phone even alone on a line,
  and a headline that wraps is not a headline — so it reads "Sat, Sep 19 · 7:30 PM", with the year added
  only when it is not this one. That evicted the game-type tag, which became the eyebrow above the title: a
  category that announces the event reads as a heading, and it leaves the title a full line at every width.
  The facts under it are one chip per fact — **Going** (green, yours), **N / M Seats Left**, **N Going** —
  where the first two used to be crammed into one pill reading "Going · 5 of 16 left", which looks like one
  fact and is two. Both roles get the same words: an organizer's copy used to say "12 seats taken", the same
  number from the other side of the table, which is a translation to do while checking your own listing.
  On a phone you can also **drag the sheet away**, which is the gesture the other two are a keyboard
  and a small target standing in for. **The whole panel is the handle** once you are at the top of it; the
  grip is only the exception that also works mid-scroll, which is what a grip is for, and it lives outside
  the scrolling body so it is never the first thing to scroll away. Taking that gesture needs a native
  `touchmove` listener: the body scrolls, so the browser claims a vertical drag and cancels the pointer
  before a second move arrives, and `preventDefault()` is the only way back — which React's passive
  `onTouchMove` cannot do. Direction is decided once, on the first 3px, and locked: down from the top is a
  dismissal, anything else stays a scroll. It engages at 6px so a tap is still a tap, and releases on
  distance *or* speed, because refusing a short flick is what makes a sheet feel stuck. The long date also stopped sharing a line with the attendance count, which is what made
  "Thursday, September 17, 2026 at 7:30 PM · 9 going" wrap to two lines on every phone.
- **An organizer edits their own event** from its page — the same `EventForm` that posts one, prefilled, and
  sending **only the fields that changed**. `PATCH /api/events/:id` is the admin's patch route with a
  different gate: same `eventPatchSchema`, same write, same capacity guard and same room-key rotation, but
  ownership is read off the row rather than from anything the client said, and a cancelled event is a 409
  (only an admin can restore one, so an edit would file changes into something nobody can see). It is
  deliberately *not* audited — `audit()` writes the trail the dashboard reads as "recent admin actions", and
  an organizer fixing their own table is not one. Where that button sits, the page used to offer "Switch to a
  player to RSVP"; the header's switcher does that on every page now, so the primary slot went back to the
  reader's own business.
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

**Turning it on.** One key, two APIs — **Places API (New)** and **Maps Static API** — on a billed Google
Cloud project, restricted to those two. The Worker reads it as `GOOGLE_MAPS_API_KEY`, and because `.env` is
for the deploy scripts rather than for the Worker, it goes in two places: `.dev.vars` for `pnpm dev`, and
`wrangler secret put GOOGLE_MAPS_API_KEY` for production. `GET /api/places/config` answers `{suggest, map}`
and is the one honest signal that it worked. No client-side key exists: the key reaches a request header and
the Static Maps URL, both inside the Worker, and `redact()` keeps it out of every log and error report.
The live demo has it configured; a fresh clone does not, and that is a supported state —

**It degrades, always.** With no `GOOGLE_MAPS_API_KEY` configured — which is what you get cloning this repo —
the typeahead is an ordinary text input, there is no mini map, and the address deep-links still work, because
Maps URLs are free and need no key. If Google is down or over budget when an event is posted, the event still
posts with the address as typed; a venue lookup is an enhancement, never a gate. The deliberate exception is
**editing** a venue — by an admin or by the owning organizer — which fails loudly with a 503: someone
re-pointing a venue is doing only that, and telling them "saved" when nothing changed is the lie
`resolvePlaceForPatch` exists to avoid.

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

Demo data note: the seeded venues are **real public civic facilities** — five Seattle library branches, three
community centres, Magnuson Park and the Bellevue library — so the map links resolve; the events, organizers
and people are invented, and no real private business is implied to be hosting anything. Their place ids,
addresses and coordinates were resolved once from the Places API at authoring time and written into
`seed.sql` by hand, so `pnpm db:reset:local` still runs offline, with no key, for free. Three events keep no
venue on purpose — a house game and two rows at a shop nobody has indexed — because the free-text path has to
stay visible beside the linked one, and a private home never gets a pin.

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
it, marked, in My RSVP. Every admin mutation writes an `audit_log` row with the actor.

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

`pnpm test` runs 399 tests *inside* the Workers runtime (`@cloudflare/vitest-plugin`) against a real local
D1 and real Durable Object instances — the same code paths as production, not mocks.

| Suite | What it proves |
|---|---|
| `test/unit/schemas` | every S4 rejection: capacity `0`/`-1`/`1.5`/`501`/`"8"`, past or malformed dates, blank titles, unknown game types |
| `test/unit/event-room` | hydration from D1; the `changes = 0` self-healing path when D1 and the room disagree |
| `test/unit/calendar` | local-day keys across the UTC-midnight boundary in both directions, grouping order, month grids for Sunday- and Monday-first weeks, leap February, today marking; week starts for Monday- and Sunday-first weeks incl. month/year boundaries, day shifts over month end, year end and Feb 29, week labels within/across a month and across a year |
| `test/api/*` | every route × every role × every error code; list ordering, filters, `%` escaping in search; the `?from=&to=` window on the board and on both `/me` lists |
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

**Two days, in clusters — not the single sitting the first version of this section described.** The
figure below is reconstructed from the 24 commit timestamps (13:31 on 2026-09-15 → 19:40 on 2026-09-16)
and is honest to about ±3 hours; the first row is the original 3–4 hour build, everything after it is what
the next section calls beyond the brief.

| Area | What landed | ~Time |
|---|---|---|
| **Core** (backend + client) | Brief, stack, the DO/D1 write path, S1–S4, the concurrency suite, stress script, React client, first deploy | 3–4 h |
| **Look and feel** | WotC-derived palette + contrast audit, logo and icon set, identity picker with one tab per role | 1.5 h |
| **Admin / operations** | Dashboard (suspend accounts, fix events, backend error log, audit log), its own orange-bar shell, FK-safe users-table rebuild | 3 h |
| **Board** (frontend + API) | Sort by date/popular, day-grouped agenda, month calendar with a windowed `?from=&to=` query for past months, filter dropdown | 3 h |
| **Board trim** (frontend) | Sort control retired, deselectable day cells, whole-span upcoming pane, filter row on one line | 0.5 h |
| **Identity switcher** (frontend) | Anchored dropdown off the name button, role colours and icons, focus return | 0.5 h |
| **Organizer editing** (frontend + API) | `PATCH /api/events/:id` with an ownership gate, one form for post and edit, changed-fields-only patch, 8 route tests | 1.5 h |
| **Venues** (backend) | Google Places proxied through the Worker, server-resolved coordinates, D1 spend ceiling, mini map, tap-to-navigate | 2 h |
| **Review pass** (UX) | 60 screenshots × 2 critic passes, 11 defects fixed, the desktop breakpoint | 2 h |
| **Data & content** | 64-event seed with clusters/past/cancelled, descriptions, game-type taxonomy research | 2 h |
| **Polish** (frontend) | Name-as-button header, role badge, segmented View switch, description field end to end, head count | 1.5 h |
| **Week agenda** (frontend + windowed `/me` endpoints) | Week strip + day pane on My RSVP, Organize and the board, past attendance, shared segmented control | 2.5 h |

Roughly **22.5 hours** all told, of which the core the brief asked for was the first four.

## How it was built

With Claude Code, in two sessions. I wrote the plan with the model (stack, schema, the exact RSVP SQL, the
DO mutex design, the freshness statement, the test matrix) and reviewed it before any code existed;
implementation agents then built the worker, the tests and the client from that plan in parallel, and a
final pass integrated them. Later features followed the same shape — a written plan with a fixed contract,
agents on disjoint files, then verification by me. Everything here I can defend line by line, because the
parts that matter were verified rather than trusted:

- every S1/S2 claim above is backed by a test I read, and the tests were checked for vacuity (see Testing);
- the Durable Object semantics the design leans on (synchronous `sql.exec`, input gates opening on a D1
  await, `blockConcurrencyWhile` resetting on throw) were cross-checked against Cloudflare's documentation
  and then exercised by the concurrency suite;
- every route was hit over real HTTP with `curl` for each status code, and the stress script was run
  against both the local server and the hosted deployment;
- the client was walked through in a headless browser (Playwright, ad hoc — not in the repo) for every
  player and organizer flow at 390px and 1440px, and the screenshots were reviewed by two independent
  critic passes; the eleven defects they found were fixed and re-verified the same way, and three of their
  findings were rejected after checking the code (they were misreadings);
- the requirements were re-read late and audited story by story against the running app, which is how the
  head count on cards and this section's time figure got corrected;
- the game-type taxonomy was chosen after checking what Tabletop.Events, Warhorn, Wizards EventLink and
  five game-store calendars actually use (see Design decisions);
- the logo, icons and background are generated by `tools/artgen/gen.py` (Gemini REST + a chroma key), so the
  art is reproducible from a prompt rather than a pile of binaries of unknown origin;
- `tools/contrast-audit.mjs` reads the real token values out of `tokens.css` and checks every text/background
  pair in both themes, so the palette claim above is measured, not eyeballed;
- every commit is one concern with the *why* in its message, so `git log` reads as the design record.

## What is beyond the brief

The brief says "the scope is deliberately small — keep it that way" and "do not gold-plate", and the
honest reading of the table above is that about three quarters of the time went past the seven stories.
Each addition was a deliberate call rather than drift, and none of it touches the write path the brief
cares about — S1–S4 are the same code and the same tests they were at hour four:

- **Admin dashboard** — because "production instincts" means someone has to be able to suspend an
  account, fix a bad event and see the error log without a database console. It lives behind its own
  shell and is reached only by URL.
- **Calendar, agenda, sort** — because with fifty live events (the launch target) a flat list stops
  answering "what is on this Saturday", and the calendar reuses the same endpoint with a date window — and
  a week agenda on My RSVP / Organize.
- **Venues** — because an address a phone can navigate to is the difference between a listing and an
  event you attend; it is keyless-safe and its whole cost surface is capped in D1. The mini map is itself the
  link to turn-by-turn, so there is no Directions button under it — that was the same tap twice. A venue with
  no map keeps the button, because then it is the only route to navigation. **The form shows the map too**,
  the moment a suggestion is picked, so an organizer sees where they just said the table is before they post
  it. That needed a second route: `EventMiniMap` is keyed by event id, and a form has no event yet.
  `/api/places/map` takes the label instead — Static Maps geocodes it inside the same billed request, so a
  preview costs one map and no Place Details, and returns the byte-identical image the coordinates would.
  The event route is bounded by an id and a matching `place_id`; this one has no id to bind to, so it is
  gated to organizers, which is also why the component fetches it by hand: an `<img src>` cannot send
  `X-User-Id`, and pointing a plain `<img>` at it answers 401 forever. It opens Maps when tapped, like every
  other map here — a *search* rather than directions, because at that point the organizer is checking they
  picked the right building, not driving to it, and the place id makes that check exact.
- **The review pass and desktop breakpoint** — because "a stranger could open it and use it" is a claim
  worth testing with fresh eyes, and the findings were real.
- **Descriptions, head count, role badge** — small, each closing a gap the audit or the review found.
- **Organizer editing** — because "post it and live with it" is not a product. It is the one place the
  public API and the operator API do the same thing, and they do it through the same schema and the same
  write on purpose.

If a reviewer would rather see the four-hour version, it is `git checkout 5d98851`.

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
4. **Event lifecycle.** An *organizer* cannot edit, cancel or resize their own event — only an admin can,
   from the dashboard — and there is no waitlist and no RSVP history (cancel is a hard delete). Organizer
   self-edit is the obvious next feature; the admin patch path already validates everything it would need.
5. **Observability.** Workers Logs is on; add request ids, structured logs around the DO write path,
   error-rate alerts, and a D1 Time Travel restore drill.
6. **CI and browser tests.** `pnpm typecheck && pnpm test` on every push, plus a committed Playwright smoke
   of the player and organizer flows. Playwright was used throughout this build to verify the client, but
   ad hoc from the scratchpad — the scripts are not in the repo and nothing runs them on a push.
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
