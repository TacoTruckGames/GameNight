-- Game Night — demo seed data.
--
-- Idempotent: wipes the three tables first, so it can be re-run any number of
-- times. Dates are relative to "now" (SQLite `strftime`), so a freshly seeded
-- board always has upcoming events, at least one FULL event, at least one event
-- that is one seat from full (the race demo), past events the upcoming filter
-- must hide, and cancelled events. `pnpm dev` re-seeds on every start on purpose.
--
-- Size is deliberate. A seven-event board renders every screen as a prototype:
-- the calendar month grid is empty white space, "popular" sorts nothing, and the
-- admin list never reaches its second page. This seed carries ~64 events — ~50
-- upcoming, 8 past, 6 cancelled — which is one row past `ADMIN_PAGE_SIZE` (50)
-- and so exercises admin pagination on a fresh database.
--
-- Note: the seed writes straight to D1 and never touches a Durable Object.
-- EventRoom hydrates itself lazily from these rows on first RSVP/cancel, which
-- is also the DO-storage-loss recovery path.

-- audit_log, error_log and api_usage first: they reference nothing, but a
-- reseeded board should not carry the previous run's operator history — nor its
-- third-party spend counters, which would otherwise make a fresh local board
-- look like it had already burnt through the day's budget.
DELETE FROM audit_log;
DELETE FROM error_log;
DELETE FROM api_usage;
DELETE FROM rsvps;
DELETE FROM events;
DELETE FROM users;

-- ---------------------------------------------------------------- users ----
-- 28 players + 4 organizers + 1 admin. Organizers are seed-only in spirit and
-- the admin is seed-only by construction: `SIGNUP_ROLES` excludes it, so
-- POST /api/users can never create one.
--
-- The player count is the interesting number. Attendance variety is bounded by
-- it: with 8 players no event can be 20/24, every attendee list is the same
-- eight names, and "nearly full" and "empty" look identical at a glance. 28 is
-- enough to fill a 26-seat convention hall and still leave rooms half empty.
--
-- `u_alice`, `org_cardboard`, `org_metro` and `adm_site` are load-bearing ids:
-- the README, the stress script and the hand-run race demo all name them. They
-- never change.
INSERT INTO users (id, name, role) VALUES
  ('u_alice', 'Alice',  'player'),
  ('u_bob',   'Bob',    'player'),
  ('u_chen',  'Chen',   'player'),
  ('u_dana',  'Dana',   'player'),
  ('u_eli',   'Eli',    'player'),
  ('u_farah', 'Farah',  'player'),
  ('u_gus',   'Gus',    'player'),
  ('u_hana',  'Hana',   'player'),
  ('u_ines',  'Ines',   'player'),
  ('u_jonas', 'Jonas',  'player'),
  ('u_kira',  'Kira',   'player'),
  ('u_liam',  'Liam',   'player'),
  ('u_mina',  'Mina',   'player'),
  ('u_noor',  'Noor',   'player'),
  ('u_omar',  'Omar',   'player'),
  ('u_priya', 'Priya',  'player'),
  ('u_quinn', 'Quinn',  'player'),
  ('u_rosa',  'Rosa',   'player'),
  ('u_sami',  'Sami',   'player'),
  ('u_tariq', 'Tariq',  'player'),
  ('u_uma',   'Uma',    'player'),
  ('u_vik',   'Vik',    'player'),
  ('u_wren',  'Wren',   'player'),
  ('u_xiu',   'Xiu',    'player'),
  ('u_yara',  'Yara',   'player'),
  ('u_zane',  'Zane',   'player'),
  ('u_aziz',  'Aziz',   'player'),
  ('u_bea',   'Bea',    'player'),
  ('org_cardboard', 'Cardboard Castle Games', 'organizer'),
  ('org_metro',     'Metro Meetup Crew',      'organizer'),
  ('org_dicegoblin','Dice Goblin Collective',  'organizer'),
  ('org_library',   'Library Games Guild',     'organizer'),
  ('adm_site',      'Site Admin',             'admin');

-- --------------------------------------------------------------- events ----
-- rsvp_count is left at 0 here and recomputed by the UPDATE at the bottom.
--
-- **The venues are real; everything else is invented.** Sixty-one of the
-- sixty-four events below are pinned to genuine public civic facilities around
-- Seattle — five library branches, three community centres, a park and the
-- Bellevue library across the lake — because a demo board full of maps of
-- nowhere proves nothing, and because a public building cannot be
-- misrepresented by a fictional game night the way a named private business
-- could. The organizers, the players, the games and the room numbers are all
-- made up, and every venue is somewhere a group like this could really book a
-- table: that is why the fictional shop and loft that used to host most of this
-- board now host three events between them.
--
-- `place_id`, address and coordinates are **real values, resolved once from the
-- Places API at authoring time and written in here by hand** — ids Google
-- actually issued for these buildings. An earlier pass used obvious
-- `seed_place_…` placeholders, reasoning that a fabricated id in Google's own
-- format would be a small lie sitting in the database waiting to be trusted.
-- That was right about fabrication and is simply moot now: these are not
-- invented, they are looked up. What has not changed is that nothing is fetched
-- at seed time — `pnpm db:reset:local` still works offline, with no API key,
-- and costs nothing.
--
-- Every event carries a place. Three used to keep NULL place columns on
-- purpose — a house game and a fictional shop, to keep the free-text path
-- visible — but a venue with no place id can show no map and cannot be
-- navigated to, and three such rows read as broken rather than as an edge
-- case. The path itself is still the form's own: the picker's "use what I
-- typed" row posts a venue Google never confirmed, and the client renders it.
--
-- ------------------------------------------------------------ about times --
-- **Every start time is written as a US Pacific evening, and is deliberately
-- NOT a round UTC hour. Do not "fix" it back.**
--
-- The board renders `starts_at` in the reader's own zone. This demo has one
-- audience — the author is in Seattle, the venues below are Seattle civic
-- buildings, and the hosted board is what a reviewer opens — so the times are
-- chosen to read correctly there: 6 PM to 11 PM Pacific, which is what a board
-- called "Game Night" with a "Friday Night Draft" on it has to say. Times were
-- briefly anchored to 15:00-23:00 UTC instead, which rendered as 8 AM - 4 PM
-- Pacific and made every title look like a lie.
--
-- The consequence, stated plainly so it surprises nobody: **a Pacific evening
-- is the next day in UTC.** Every row below lands between 01:00 and 06:00 UTC,
-- and its UTC date runs one day ahead of the local date it belongs to. A reader
-- outside the Americas sees these shifted — a London reader gets 2 AM - 7 AM.
-- That is the honest trade for a single-audience demo; no hour is evening
-- everywhere.
--
-- So the dates are anchored to the *Pacific* day boundary, not the UTC one:
--
--   'now','-7 hours'      step into Pacific wall-clock time
--   'start of day'        midnight of the local day — the day the board files
--                         the event under
--   '+N days','+H hours'  N local days out, at local hour H (fractional for the
--                         half-hour slots: 18.5 is 6:30 PM)
--   '+7 hours'            step back out to the UTC the column stores
--
-- That chain is what keeps a cluster on ONE Pacific calendar day no matter what
-- time of day the seed is run, which is the whole point of the clusters below:
-- the month grid counts local days.
--
-- -7/+7 is PDT. From November to March the same rows read 5 PM - 10 PM Pacific
-- instead of 6 PM - 11 PM: still evening, still one local day, so the seed does
-- not chase DST.
--
-- All seven of the original events had their times moved into this window.
-- Their local *day* offsets are unchanged, so the board reads as it always did,
-- and nothing else about them changed: ids, titles, capacities, venues, place
-- rows and hand-written RSVP sets are untouched.
INSERT INTO events (id, organizer_id, title, game_type, starts_at, location, capacity, rsvp_count, room_key,
                    place_id, place_address, place_lat, place_lng, place_resolved_at) VALUES
  -- Lake City Branch (real public library).
  --
  -- This row, `evt_league_finals_draft` and `evt_dnd_curse_amber` were the last
  -- three free-text venues on the board — a fictional shop and somebody's dining
  -- room, kept so the unverified path stayed visible in the demo. They are gone:
  -- every event now carries a place Google issued, because a venue with no place
  -- id cannot show a map and cannot be navigated to, and three rows that could
  -- do neither read as broken rather than as a deliberate edge case. The path
  -- itself is still reachable — the picker's "use what I typed" row posts a
  -- free-text venue, and the client renders it (checked by a Playwright pass, ad hoc — not in the repo).
  ('evt_friday_draft', 'org_cardboard', 'Friday Night Draft', 'card',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+2 days','+20 hours','+7 hours'),
   'Lake City Library, meeting room', 8, 0, lower(hex(randomblob(8))),
   'ChIJhWb17mQRkFQRNqp3mBpKXrQ', '12501 28th Ave NE, Seattle, WA 98125, USA', 47.719716, -122.298113,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- Capitol Hill Branch (real public library).
  ('evt_commander_pod', 'org_cardboard', 'Commander Pod Night', 'card',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+3 days','+19.5 hours','+7 hours'),
   'Capitol Hill Library, meeting room', 4, 0, lower(hex(randomblob(8))),
   'ChIJ1Y9IDC4VkFQRteLhIs-Bf4I', '425 Harvard Ave E, Seattle, WA 98102, USA', 47.623, -122.322397,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- Seattle Central Library (real public library). The label keeps the room
  -- number the organizer cares about; the address is Google's canonical form.
  ('evt_dnd_sunken_vault', 'org_metro', 'D&D One-Shot: The Sunken Vault', 'rpg',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+4 days','+19.5 hours','+7 hours'),
   'Central Library, Room 2B', 5, 0, lower(hex(randomblob(8))),
   'ChIJ55fLWVtBkFQR0v31eadEoLM', '1000 4th Ave, Seattle, WA 98104, USA', 47.606766, -122.332644,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- Seattle Public Library, Ballard Branch (real public library).
  ('evt_board_game_meetup', 'org_metro', 'Board Game Meetup', 'board',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+6 days','+19 hours','+7 hours'),
   'Ballard Library, meeting room', 12, 0, lower(hex(randomblob(8))),
   'ChIJqci788UVkFQREdTIYKi-mYs', '5614 22nd Ave NW, Seattle, WA 98107, USA', 47.66981, -122.384271,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- Green Lake Community Center (real city community centre).
  ('evt_warhammer_open', 'org_metro', 'Warhammer 40k Open Play', 'miniatures',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+9 days','+18.5 hours','+7 hours'),
   'Green Lake Community Center, main hall', 6, 0, lower(hex(randomblob(8))),
   'ChIJk4QZY2sUkFQR3aJEU8ufnJk', '7201 East Green Lake Dr N, Seattle, WA 98115, USA', 47.68026, -122.328503,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- Warren G. Magnuson Park (real city park). Proves the search join: nothing in
  -- the typed label says "Sand Point", but ?q=Sand Point finds this event.
  ('evt_learn_magic', 'org_cardboard', 'Learn to Play Magic', 'other',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+14 days','+20.5 hours','+7 hours'),
   'Magnuson Park, Building 30', 10, 0, lower(hex(randomblob(8))),
   'ChIJTSbT3aATkFQRHymm3sgqcb8', '7400 Sand Point Way NE, Seattle, WA 98115, USA', 47.679769, -122.253602,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- Past event: must never appear in the upcoming list, and RSVPs to it 409.
  -- University Branch (real public library).
  ('evt_last_week_draft', 'org_cardboard', 'Last Week''s Draft', 'card',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','-3 days','+20 hours','+7 hours'),
   'University Library, meeting room', 8, 0, lower(hex(randomblob(8))),
   'ChIJVZZq9mAUkFQRRAHfUiu_sc0', '5009 Roosevelt Way NE, Seattle, WA 98105, USA', 47.665245, -122.317923,
   strftime('%Y-%m-%dT%H:%M:%SZ','now'));

-- ------------------------------------------- the rest of the upcoming board --
-- 44 more scheduled events across the next five weeks, bringing the upcoming
-- board to 50.
--
-- **The clustering is the point.** Real community boards are lumpy: a
-- convention weekend, a league night, then four quiet days. An even one-event-
-- a-day smear makes the month grid look generated, which is exactly what it
-- would be. So the day offsets below are chosen, not spread. Every offset is
-- a **Pacific local day** — the day the board and the month grid file the
-- event under, not the UTC date stored in the column:
--
--   +12 / +13   the "Game Fest" weekend — 4 and 5 events, one venue, slots
--               staggered 6 PM through 11 PM local, every game type. This is the day-detail drill-down
--               demo and the reason the calendar cell needs a "+N more".
--   +19         league finals night, 4 events, three organizers at once.
--   +6          4 events (the Board Game Meetup above plus three).
--   +2 +4 +9 +14 +26   3 events each — the ordinary busy evening.
--   +1 +3 +17 +22 +33  2 each; +7 +10 +16 +20 +24 +27 +30 +35  exactly 1.
--   +5 +8 +11 +15 +18 +21 +23 +25 +28 +29 +31 +32 +34   deliberately empty.
--
-- Capacities run from 4 to 40 so the seat bar has something to say. Fill levels
-- are assigned in the RSVP generator at the foot of this file, not here.
--
-- Every row below carries a real place — ids Google issued, resolved once at
-- authoring time — so every card on the board has a map and a route to it.
INSERT INTO events (id, organizer_id, title, game_type, starts_at, location, capacity, rsvp_count, room_key,
                    place_id, place_address, place_lat, place_lng, place_resolved_at) VALUES
  -- +1 day (2)
  ('evt_midweek_modern', 'org_cardboard', 'Midweek Modern Night', 'other',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+1 days','+19.5 hours','+7 hours'),
   'Northgate Community Center, multipurpose room', 16, 0, lower(hex(randomblob(8))),
   'ChIJNauPGVYRkFQRBY2bPEB3jfU', '10510 5th Ave NE, Seattle, WA 98125, USA', 47.705455, -122.32236,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  -- Greenwood Branch (real public library). Was "Greenwood House, dining room".
  ('evt_dnd_curse_amber', 'org_metro', 'D&D: The Curse of Amberfall', 'rpg',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+1 days','+23 hours','+7 hours'),
   'Greenwood Library, meeting room', 6, 0, lower(hex(randomblob(8))),
   'ChIJ7eJjtyMUkFQRlrk_dVTDvxk', '8016 Greenwood Ave N, Seattle, WA 98103, USA', 47.687452, -122.354757,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- +2 days (2 more, alongside Friday Night Draft)
  ('evt_catan_tournament', 'org_dicegoblin', 'Catan Tournament', 'board',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+2 days','+19 hours','+7 hours'),
   'Columbia Library, meeting room', 16, 0, lower(hex(randomblob(8))),
   'ChIJv5x3_wxqkFQRs76P7-fM9GE', '4721 Rainier Ave S, Seattle, WA 98118, USA', 47.559901, -122.286959,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('evt_kill_team_night', 'org_metro', 'Kill Team Skirmish Night', 'miniatures',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+2 days','+20.5 hours','+7 hours'),
   'Green Lake Community Center, main hall', 8, 0, lower(hex(randomblob(8))),
   'ChIJk4QZY2sUkFQR3aJEU8ufnJk', '7201 East Green Lake Dr N, Seattle, WA 98115, USA', 47.68026, -122.328503,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- +3 days (1 more)
  ('evt_pauper_league', 'org_cardboard', 'Pauper League Week 3', 'other',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+3 days','+21 hours','+7 hours'),
   'Central Library, Room 3C', 12, 0, lower(hex(randomblob(8))),
   'ChIJ55fLWVtBkFQR0v31eadEoLM', '1000 4th Ave, Seattle, WA 98104, USA', 47.606766, -122.332644,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- +4 days (2 more)
  ('evt_board_game_potluck', 'org_library', 'Board Game Potluck', 'board',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+4 days','+18.5 hours','+7 hours'),
   'Ballard Library, meeting room', 20, 0, lower(hex(randomblob(8))),
   'ChIJqci788UVkFQREdTIYKi-mYs', '5614 22nd Ave NW, Seattle, WA 98107, USA', 47.66981, -122.384271,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('evt_commander_precon', 'org_dicegoblin', 'Precon Commander Night', 'card',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+4 days','+20.5 hours','+7 hours'),
   'Rainier Community Center, game room', 8, 0, lower(hex(randomblob(8))),
   'ChIJAZfGcw1qkFQRL1KrHhXvV0c', '4600 38th Ave. S, Seattle, WA 98118, USA', 47.561389, -122.284164,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- +6 days (3 more)
  ('evt_draft_set_release', 'org_cardboard', 'Booster Draft: Set Release', 'card',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+6 days','+20 hours','+7 hours'),
   'Columbia Library, meeting room', 8, 0, lower(hex(randomblob(8))),
   'ChIJv5x3_wxqkFQRs76P7-fM9GE', '4721 Rainier Ave S, Seattle, WA 98118, USA', 47.559901, -122.286959,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('evt_dnd_gilded_fox', 'org_metro', 'D&D One-Shot: Tomb of the Gilded Fox', 'rpg',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+6 days','+22 hours','+7 hours'),
   'Central Library, Room 4A', 6, 0, lower(hex(randomblob(8))),
   'ChIJ55fLWVtBkFQR0v31eadEoLM', '1000 4th Ave, Seattle, WA 98104, USA', 47.606766, -122.332644,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('evt_wargame_intro', 'org_library', 'Intro to Miniature Wargaming', 'miniatures',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+6 days','+18.5 hours','+7 hours'),
   'Magnuson Park, Building 30', 10, 0, lower(hex(randomblob(8))),
   'ChIJTSbT3aATkFQRHymm3sgqcb8', '7400 Sand Point Way NE, Seattle, WA 98115, USA', 47.679769, -122.253602,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- +7 days (1)
  ('evt_family_game_hour', 'org_library', 'Family Game Hour', 'board',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+7 days','+18 hours','+7 hours'),
   'Ballard Library, meeting room', 24, 0, lower(hex(randomblob(8))),
   'ChIJqci788UVkFQREdTIYKi-mYs', '5614 22nd Ave NW, Seattle, WA 98107, USA', 47.66981, -122.384271,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- +9 days (2 more, alongside Warhammer 40k Open Play)
  ('evt_commander_chaos', 'org_dicegoblin', 'Chaos Commander: Four-Player Pods', 'card',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+9 days','+19.5 hours','+7 hours'),
   'Bellevue Library, meeting room 1', 16, 0, lower(hex(randomblob(8))),
   'ChIJAf2ta4xskFQRMkLmAk-vP7o', '1111 110th Ave NE, Bellevue, WA 98004, USA', 47.620044, -122.194169,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('evt_rpg_open_table', 'org_metro', 'Open Table RPG Night', 'rpg',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+9 days','+21 hours','+7 hours'),
   'Rainier Community Center, game room', 7, 0, lower(hex(randomblob(8))),
   'ChIJAZfGcw1qkFQRL1KrHhXvV0c', '4600 38th Ave. S, Seattle, WA 98118, USA', 47.561389, -122.284164,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- +10 days (1)
  ('evt_draft_vintage_cube', 'org_cardboard', 'Vintage Cube Draft', 'card',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+10 days','+20 hours','+7 hours'),
   'Bellevue Library, meeting room 1', 8, 0, lower(hex(randomblob(8))),
   'ChIJAf2ta4xskFQRMkLmAk-vP7o', '1111 110th Ave NE, Bellevue, WA 98004, USA', 47.620044, -122.194169,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- +12 days — Game Fest, day one (4). One venue, four staggered slots.
  ('evt_fest_warhammer_tourney', 'org_library', 'Game Fest: Warhammer 40k Tournament', 'miniatures',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+12 days','+18 hours','+7 hours'),
   'Magnuson Park, Building 30', 16, 0, lower(hex(randomblob(8))),
   'ChIJTSbT3aATkFQRHymm3sgqcb8', '7400 Sand Point Way NE, Seattle, WA 98115, USA', 47.679769, -122.253602,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('evt_fest_flagship_draft', 'org_cardboard', 'Game Fest: Flagship Draft', 'card',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+12 days','+18.5 hours','+7 hours'),
   'Magnuson Park, Building 30', 32, 0, lower(hex(randomblob(8))),
   'ChIJTSbT3aATkFQRHymm3sgqcb8', '7400 Sand Point Way NE, Seattle, WA 98115, USA', 47.679769, -122.253602,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('evt_fest_commander_gauntlet', 'org_dicegoblin', 'Game Fest: Commander Gauntlet', 'card',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+12 days','+19.5 hours','+7 hours'),
   'Magnuson Park, Building 30', 20, 0, lower(hex(randomblob(8))),
   'ChIJTSbT3aATkFQRHymm3sgqcb8', '7400 Sand Point Way NE, Seattle, WA 98115, USA', 47.679769, -122.253602,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('evt_fest_dnd_marathon', 'org_metro', 'Game Fest: D&D Marathon', 'rpg',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+12 days','+20.5 hours','+7 hours'),
   'Magnuson Park, Building 30', 8, 0, lower(hex(randomblob(8))),
   'ChIJTSbT3aATkFQRHymm3sgqcb8', '7400 Sand Point Way NE, Seattle, WA 98115, USA', 47.679769, -122.253602,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- +13 days — Game Fest, day two (5). The heaviest day on the board; the
  -- open library is the one event here that carries a verified place.
  ('evt_fest_board_library', 'org_library', 'Game Fest: Open Board Game Library', 'board',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+13 days','+18 hours','+7 hours'),
   'Magnuson Park, Building 30', 40, 0, lower(hex(randomblob(8))),
   'ChIJTSbT3aATkFQRHymm3sgqcb8', '7400 Sand Point Way NE, Seattle, WA 98115, USA', 47.679769, -122.253602,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('evt_fest_learn_anything', 'org_cardboard', 'Game Fest: Learn to Play Anything', 'other',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+13 days','+19 hours','+7 hours'),
   'Magnuson Park, Building 30', 24, 0, lower(hex(randomblob(8))),
   'ChIJTSbT3aATkFQRHymm3sgqcb8', '7400 Sand Point Way NE, Seattle, WA 98115, USA', 47.679769, -122.253602,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('evt_fest_sealed_finals', 'org_cardboard', 'Game Fest: Sealed Finals', 'card',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+13 days','+20 hours','+7 hours'),
   'Magnuson Park, Building 30', 16, 0, lower(hex(randomblob(8))),
   'ChIJTSbT3aATkFQRHymm3sgqcb8', '7400 Sand Point Way NE, Seattle, WA 98115, USA', 47.679769, -122.253602,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('evt_fest_indie_rpg', 'org_metro', 'Game Fest: Indie RPG Showcase', 'rpg',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+13 days','+21 hours','+7 hours'),
   'Magnuson Park, Building 30', 12, 0, lower(hex(randomblob(8))),
   'ChIJTSbT3aATkFQRHymm3sgqcb8', '7400 Sand Point Way NE, Seattle, WA 98115, USA', 47.679769, -122.253602,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('evt_fest_closing_pods', 'org_dicegoblin', 'Game Fest: Closing Commander Pods', 'card',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+13 days','+23 hours','+7 hours'),
   'Magnuson Park, Building 30', 12, 0, lower(hex(randomblob(8))),
   'ChIJTSbT3aATkFQRHymm3sgqcb8', '7400 Sand Point Way NE, Seattle, WA 98115, USA', 47.679769, -122.253602,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- +14 days (2 more, alongside Learn to Play Magic)
  ('evt_kids_board_club', 'org_library', 'Kids Board Game Club', 'board',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+14 days','+18.5 hours','+7 hours'),
   'Ballard Library, meeting room', 18, 0, lower(hex(randomblob(8))),
   'ChIJqci788UVkFQREdTIYKi-mYs', '5614 22nd Ave NW, Seattle, WA 98107, USA', 47.66981, -122.384271,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('evt_warhammer_narrative', 'org_metro', 'Narrative Warhammer Campaign, Session 1', 'miniatures',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+14 days','+20 hours','+7 hours'),
   'Green Lake Community Center, main hall', 6, 0, lower(hex(randomblob(8))),
   'ChIJk4QZY2sUkFQR3aJEU8ufnJk', '7201 East Green Lake Dr N, Seattle, WA 98115, USA', 47.68026, -122.328503,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- +16 days (1)
  ('evt_draft_two_headed', 'org_cardboard', 'Two-Headed Giant Draft', 'card',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+16 days','+19.5 hours','+7 hours'),
   'Rainier Community Center, game room', 12, 0, lower(hex(randomblob(8))),
   'ChIJAZfGcw1qkFQRL1KrHhXvV0c', '4600 38th Ave. S, Seattle, WA 98118, USA', 47.561389, -122.284164,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- +17 days (2)
  ('evt_commander_budget', 'org_dicegoblin', 'Budget Commander Brawl', 'card',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+17 days','+20.5 hours','+7 hours'),
   'Rainier Community Center, game room', 8, 0, lower(hex(randomblob(8))),
   'ChIJAZfGcw1qkFQRL1KrHhXvV0c', '4600 38th Ave. S, Seattle, WA 98118, USA', 47.561389, -122.284164,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('evt_dnd_west_marches', 'org_metro', 'West Marches: Session 12', 'rpg',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+17 days','+22 hours','+7 hours'),
   'Columbia Library, meeting room', 6, 0, lower(hex(randomblob(8))),
   'ChIJv5x3_wxqkFQRs76P7-fM9GE', '4721 Rainier Ave S, Seattle, WA 98118, USA', 47.559901, -122.286959,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- +19 days — league finals night (4), three organizers running at once.
  ('evt_library_game_day', 'org_library', 'Library Game Day', 'board',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+19 days','+18 hours','+7 hours'),
   'Central Library, Room 2B', 30, 0, lower(hex(randomblob(8))),
   'ChIJ55fLWVtBkFQR0v31eadEoLM', '1000 4th Ave, Seattle, WA 98104, USA', 47.606766, -122.332644,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  -- Delridge Community Center (real). Was the same fictional shop as above.
  ('evt_league_finals_draft', 'org_cardboard', 'Draft League Finals', 'card',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+19 days','+19 hours','+7 hours'),
   'Delridge Community Center, main hall', 16, 0, lower(hex(randomblob(8))),
   'ChIJu0pJilJAkFQRy5Q1Wb-lKxY', '4501 Delridge Wy SW, Seattle, WA 98106, USA', 47.563315, -122.364384,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('evt_warhammer_doubles', 'org_metro', 'Warhammer Doubles Night', 'miniatures',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+19 days','+20 hours','+7 hours'),
   'Green Lake Community Center, main hall', 8, 0, lower(hex(randomblob(8))),
   'ChIJk4QZY2sUkFQR3aJEU8ufnJk', '7201 East Green Lake Dr N, Seattle, WA 98115, USA', 47.68026, -122.328503,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('evt_puzzle_night', 'org_dicegoblin', 'Co-op Puzzle Night', 'other',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+19 days','+21 hours','+7 hours'),
   'Columbia Library, meeting room', 10, 0, lower(hex(randomblob(8))),
   'ChIJv5x3_wxqkFQRs76P7-fM9GE', '4721 Rainier Ave S, Seattle, WA 98118, USA', 47.559901, -122.286959,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- +20 days (1)
  ('evt_dnd_saltmarsh', 'org_metro', 'D&D: Saltmarsh Pirates', 'rpg',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+20 days','+19.5 hours','+7 hours'),
   'Northgate Community Center, multipurpose room', 6, 0, lower(hex(randomblob(8))),
   'ChIJNauPGVYRkFQRBY2bPEB3jfU', '10510 5th Ave NE, Seattle, WA 98125, USA', 47.705455, -122.32236,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- +22 days (2)
  ('evt_board_heavy_euro', 'org_dicegoblin', 'Heavy Euro Games Evening', 'board',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+22 days','+18.5 hours','+7 hours'),
   'Bellevue Library, meeting room 1', 12, 0, lower(hex(randomblob(8))),
   'ChIJAf2ta4xskFQRMkLmAk-vP7o', '1111 110th Ave NE, Bellevue, WA 98004, USA', 47.620044, -122.194169,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('evt_draft_chaos_cube', 'org_cardboard', 'Chaos Cube Draft', 'card',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+22 days','+20 hours','+7 hours'),
   'Capitol Hill Library, meeting room', 8, 0, lower(hex(randomblob(8))),
   'ChIJ1Y9IDC4VkFQRteLhIs-Bf4I', '425 Harvard Ave E, Seattle, WA 98102, USA', 47.623, -122.322397,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- +24 days (1)
  ('evt_commander_cedh', 'org_dicegoblin', 'cEDH Practice Pods', 'card',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+24 days','+20.5 hours','+7 hours'),
   'Rainier Community Center, game room', 8, 0, lower(hex(randomblob(8))),
   'ChIJAZfGcw1qkFQRL1KrHhXvV0c', '4600 38th Ave. S, Seattle, WA 98118, USA', 47.561389, -122.284164,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- +26 days (3)
  ('evt_dnd_beginners', 'org_library', 'D&D for Absolute Beginners', 'rpg',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+26 days','+18.5 hours','+7 hours'),
   'Ballard Library, meeting room', 12, 0, lower(hex(randomblob(8))),
   'ChIJqci788UVkFQREdTIYKi-mYs', '5614 22nd Ave NW, Seattle, WA 98107, USA', 47.66981, -122.384271,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('evt_warhammer_paint', 'org_metro', 'Paint and Play Warhammer', 'miniatures',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+26 days','+19.5 hours','+7 hours'),
   'Green Lake Community Center, main hall', 10, 0, lower(hex(randomblob(8))),
   'ChIJk4QZY2sUkFQR3aJEU8ufnJk', '7201 East Green Lake Dr N, Seattle, WA 98115, USA', 47.68026, -122.328503,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('evt_trivia_night', 'org_cardboard', 'Tabletop Trivia Night', 'other',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+26 days','+21 hours','+7 hours'),
   'University Library, meeting room', 20, 0, lower(hex(randomblob(8))),
   'ChIJVZZq9mAUkFQRRAHfUiu_sc0', '5009 Roosevelt Way NE, Seattle, WA 98105, USA', 47.665245, -122.317923,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- +27 days (1)
  ('evt_draft_team_league', 'org_cardboard', 'Team Draft League', 'card',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+27 days','+20 hours','+7 hours'),
   'Northgate Community Center, multipurpose room', 12, 0, lower(hex(randomblob(8))),
   'ChIJNauPGVYRkFQRBY2bPEB3jfU', '10510 5th Ave NE, Seattle, WA 98125, USA', 47.705455, -122.32236,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- +30 days (1)
  ('evt_board_game_swap', 'org_library', 'Board Game Swap Meet', 'board',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+30 days','+18 hours','+7 hours'),
   'Central Library, Room 2B', 25, 0, lower(hex(randomblob(8))),
   'ChIJ55fLWVtBkFQR0v31eadEoLM', '1000 4th Ave, Seattle, WA 98104, USA', 47.606766, -122.332644,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- +33 days (2)
  ('evt_commander_cracked_packs', 'org_dicegoblin', 'Commander Cracked Packs', 'card',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+33 days','+20.5 hours','+7 hours'),
   'Columbia Library, meeting room', 16, 0, lower(hex(randomblob(8))),
   'ChIJv5x3_wxqkFQRs76P7-fM9GE', '4721 Rainier Ave S, Seattle, WA 98118, USA', 47.559901, -122.286959,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('evt_dnd_campaign_finale', 'org_metro', 'D&D Campaign Finale', 'rpg',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+33 days','+22 hours','+7 hours'),
   'Bellevue Library, meeting room 1', 6, 0, lower(hex(randomblob(8))),
   'ChIJAf2ta4xskFQRMkLmAk-vP7o', '1111 110th Ave NE, Bellevue, WA 98004, USA', 47.620044, -122.194169,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- +35 days (1) — the far edge of the five-week window, barely signed up yet.
  ('evt_prerelease_draft', 'org_cardboard', 'Set Prerelease Draft', 'card',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+35 days','+19.5 hours','+7 hours'),
   'Central Library, Room 3C', 16, 0, lower(hex(randomblob(8))),
   'ChIJ55fLWVtBkFQR0v31eadEoLM', '1000 4th Ave, Seattle, WA 98104, USA', 47.606766, -122.332644,
   strftime('%Y-%m-%dT%H:%M:%SZ','now'));

-- ------------------------------------------------------------ past events --
-- Seven more finished events, from two days back to a little over two weeks,
-- joining Last Week's Draft. Two days, not one: a local-evening event yesterday
-- would sit only ~6 hours behind a seed run just after Pacific midnight, close
-- enough to `now` that a badly timed reseed makes "past" a coin flip. -2 local
-- days is never less than 30 hours in the past, whenever the seed runs. They exist to prove three things at once: the
-- board hides them, `/api/me/rsvps` hides them, and the admin list does not —
-- an operator looking at "all events" should see history, which is also what
-- pushes the admin table onto a second page.
INSERT INTO events (id, organizer_id, title, game_type, starts_at, location, capacity, rsvp_count, room_key,
                    place_id, place_address, place_lat, place_lng, place_resolved_at) VALUES
  ('evt_past_commander_league', 'org_dicegoblin', 'Commander League Night', 'card',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','-2 days','+20.5 hours','+7 hours'),
   'Bellevue Library, meeting room 1', 12, 0, lower(hex(randomblob(8))),
   'ChIJAf2ta4xskFQRMkLmAk-vP7o', '1111 110th Ave NE, Bellevue, WA 98004, USA', 47.620044, -122.194169,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('evt_past_board_brunch', 'org_library', 'Board Game Brunch', 'board',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','-2 days','+18.5 hours','+7 hours'),
   'Ballard Library, meeting room', 20, 0, lower(hex(randomblob(8))),
   'ChIJqci788UVkFQREdTIYKi-mYs', '5614 22nd Ave NW, Seattle, WA 98107, USA', 47.66981, -122.384271,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  -- Ran full. A past FULL event is its own small regression test: the seat bar
  -- and the "FULL" badge have to render for an event nobody can join any more.
  ('evt_past_dnd_icespire', 'org_metro', 'D&D: Dragon of Icespire, Session 4', 'rpg',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','-4 days','+22 hours','+7 hours'),
   'University Library, meeting room', 6, 0, lower(hex(randomblob(8))),
   'ChIJVZZq9mAUkFQRRAHfUiu_sc0', '5009 Roosevelt Way NE, Seattle, WA 98105, USA', 47.665245, -122.317923,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('evt_past_warhammer_league', 'org_metro', 'Warhammer League Round 2', 'miniatures',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','-6 days','+19.5 hours','+7 hours'),
   'Green Lake Community Center, main hall', 8, 0, lower(hex(randomblob(8))),
   'ChIJk4QZY2sUkFQR3aJEU8ufnJk', '7201 East Green Lake Dr N, Seattle, WA 98115, USA', 47.68026, -122.328503,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('evt_past_thursday_draft', 'org_cardboard', 'Thursday Draft', 'card',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','-8 days','+20 hours','+7 hours'),
   'Columbia Library, meeting room', 8, 0, lower(hex(randomblob(8))),
   'ChIJv5x3_wxqkFQRs76P7-fM9GE', '4721 Rainier Ave S, Seattle, WA 98118, USA', 47.559901, -122.286959,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('evt_past_learn_rpg', 'org_library', 'Learn an RPG in One Night', 'other',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','-11 days','+19 hours','+7 hours'),
   'Central Library, Room 4A', 15, 0, lower(hex(randomblob(8))),
   'ChIJ55fLWVtBkFQR0v31eadEoLM', '1000 4th Ave, Seattle, WA 98104, USA', 47.606766, -122.332644,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('evt_past_autumn_swap', 'org_library', 'Autumn Game Swap', 'board',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','-16 days','+18 hours','+7 hours'),
   'Magnuson Park, Building 30', 24, 0, lower(hex(randomblob(8))),
   'ChIJTSbT3aATkFQRHymm3sgqcb8', '7400 Sand Point Way NE, Seattle, WA 98115, USA', 47.679769, -122.253602,
   strftime('%Y-%m-%dT%H:%M:%SZ','now'));

-- ------------------------------------------------------- cancelled events --
-- Cancellation is a status, not a delete (see 0002_admin.sql), and the seed has
-- to show that. Four upcoming and two past:
--
--   * `evt_cancel_late_pod` is the important one. Alice holds a seat on it, so
--     "My RSVP" renders a cancelled card — the case `listPlayerRsvps` is
--     deliberately not status-filtered for. It must NOT appear on the public
--     board.
--   * `evt_cancel_grand_melee` sits inside the Game Fest weekend: the calendar
--     day count and the board day count disagree by one, on purpose.
--   * `evt_cancel_board_marathon` was called off before anyone signed up — 0
--     RSVPs, so nobody is owed a notification.
--   * The two past ones keep the admin list honest about history.
--
-- `cancelled_at` is always set. A cancelled row with a NULL timestamp makes the
-- admin UI invent a story about when it happened, and every real cancellation
-- goes through the route that stamps it.
INSERT INTO events (id, organizer_id, title, game_type, starts_at, location, capacity, rsvp_count, room_key,
                    status, cancelled_at,
                    place_id, place_address, place_lat, place_lng, place_resolved_at) VALUES
  ('evt_cancel_late_pod', 'org_dicegoblin', 'Late Night Commander Pod', 'card',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+7 days','+21 hours','+7 hours'),
   'Rainier Community Center, game room', 8, 0, lower(hex(randomblob(8))),
   'cancelled', strftime('%Y-%m-%dT%H:%M:%SZ','now','-2 days'),
   'ChIJAZfGcw1qkFQRL1KrHhXvV0c', '4600 38th Ave. S, Seattle, WA 98118, USA', 47.561389, -122.284164,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('evt_cancel_grand_melee', 'org_metro', 'Warhammer Grand Melee', 'miniatures',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+13 days','+19 hours','+7 hours'),
   'Green Lake Community Center, main hall', 12, 0, lower(hex(randomblob(8))),
   'cancelled', strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 days'),
   'ChIJk4QZY2sUkFQR3aJEU8ufnJk', '7201 East Green Lake Dr N, Seattle, WA 98115, USA', 47.68026, -122.328503,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('evt_cancel_frostmaiden', 'org_metro', 'D&D: Rime of the Frostmaiden, Session 1', 'rpg',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+20 days','+20.5 hours','+7 hours'),
   'Capitol Hill Library, meeting room', 6, 0, lower(hex(randomblob(8))),
   'cancelled', strftime('%Y-%m-%dT%H:%M:%SZ','now','-6 hours'),
   'ChIJ1Y9IDC4VkFQRteLhIs-Bf4I', '425 Harvard Ave E, Seattle, WA 98102, USA', 47.623, -122.322397,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('evt_cancel_board_marathon', 'org_library', 'Board Game Marathon', 'board',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+26 days','+18 hours','+7 hours'),
   'Ballard Library, meeting room', 20, 0, lower(hex(randomblob(8))),
   'cancelled', strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 days'),
   'ChIJqci788UVkFQREdTIYKi-mYs', '5614 22nd Ave NW, Seattle, WA 98107, USA', 47.66981, -122.384271,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('evt_cancel_snow_draft', 'org_cardboard', 'Snow Day Draft', 'card',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','-5 days','+20 hours','+7 hours'),
   'Bellevue Library, meeting room 1', 8, 0, lower(hex(randomblob(8))),
   'cancelled', strftime('%Y-%m-%dT%H:%M:%SZ','now','-6 days'),
   'ChIJAf2ta4xskFQRMkLmAk-vP7o', '1111 110th Ave NE, Bellevue, WA 98004, USA', 47.620044, -122.194169,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('evt_cancel_midsummer', 'org_metro', 'Midsummer Game Social', 'other',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','-12 days','+19.5 hours','+7 hours'),
   'Magnuson Park, Building 30', 30, 0, lower(hex(randomblob(8))),
   'cancelled', strftime('%Y-%m-%dT%H:%M:%SZ','now','-14 days'),
   'ChIJTSbT3aATkFQRHymm3sgqcb8', '7400 Sand Point Way NE, Seattle, WA 98115, USA', 47.679769, -122.253602,
   strftime('%Y-%m-%dT%H:%M:%SZ','now'));

-- --------------------------------------------------------- descriptions ----
-- Applied as one UPDATE pass keyed by id, for the same reason `rsvp_count` is
-- derived at the foot of this file rather than typed into each row: a 15th
-- column threaded through four multi-row INSERTs is four places to miscount
-- commas, and the prose stops being readable the moment it is wedged between a
-- capacity and a `randomblob`. Keeping it as a block means the demo copy can be
-- read, and rewritten, as copy.
--
-- Length is bounded by `DESCRIPTION_MAX` (500) — the API rejects anything
-- longer, so a seed row that sailed past it would be a fixture the product
-- itself would refuse to create. Everything below sits in the 180-260 range:
-- two or three sentences, which is what an organizer actually writes.
--
-- **Nine events deliberately have none, and that is a fixture, not a gap.**
-- A description is nullable because a house game posted in a hurry has no
-- description, and the detail page, the card and the admin table all have to
-- render that state without an empty box or the word "undefined". Blank must be
-- NULL and never `''`, so those nine are simply absent from the list below
-- rather than carrying an empty string. They are spread on purpose — six
-- upcoming, two past, one cancelled — so a reviewer meets the no-description
-- case without hunting for it:
--
--   evt_dnd_curse_amber, evt_pauper_league, evt_rpg_open_table,
--   evt_commander_budget, evt_draft_chaos_cube, evt_prerelease_draft,
--   evt_past_warhammer_league, evt_past_thursday_draft, evt_cancel_snow_draft
--
-- Every id below must exist. The UPDATE matches on id, so a misspelt id is not
-- an error — it is simply a description that quietly never appears, which is the
-- one failure mode of doing it this way. The check is one query:
-- `SELECT COUNT(description) FROM events` must be 55, out of 64 rows.
WITH descriptions (id, body) AS (VALUES
  -- upcoming ----------------------------------------------------------------
  ('evt_friday_draft',
   'Eight-person booster draft, three rounds of Swiss, packs provided. Bring a deck box and sleeves if you have them; everything else is on the shop. Doors at 7:30 for registration, first pack cracked at 8. We are usually done by 11.'),
  ('evt_commander_pod',
   'One four-player pod at casual power level — precons and lightly upgraded precons, nothing that wins on turn four. Bring your own deck. We play two or three games depending on how long the first one runs.'),
  ('evt_dnd_sunken_vault',
   'A self-contained 5e one-shot for levels 3-5, about three hours at the table. Pre-generated characters and dice are provided, so there is nothing to bring and nothing to prepare. New players are welcome; we teach the rules as we go.'),
  ('evt_board_game_meetup',
   'Open tables in the Ballard branch meeting room. We bring a shelf of modern games — Azul, Wingspan, Cascadia and a few heavier boxes — and will teach anything you want to try. Drop in any time; games run 45 minutes to two hours.'),
  ('evt_warhammer_open',
   'Open play: no tournament, no list restrictions. Bring your army, dice and a tape measure; we set up the terrain and three tables in the main hall. Pick-up games all evening at whatever points level you and your opponent agree on.'),
  ('evt_learn_magic',
   'A ground-up introduction to Magic for people who have never shuffled a deck. Loaner decks are provided and we cover the turn, combat and the stack over about two hours. Nothing to buy. Building 30 is in from the Sand Point Way entrance.'),
  ('evt_midweek_modern',
   'Modern night, four rounds of Swiss. Bring a 60-card deck and a sideboard. The field is usually half brews and half real decks, so it is a friendly place to try something. Prizes in store credit; rounds are 50 minutes and start on time.'),
  ('evt_catan_tournament',
   'Four tables of Catan over three rounds, with points carried between games. Copies are supplied, so just turn up. Rules refresher at 7 for anyone who has not played since college. Expect to finish a little after 10.'),
  ('evt_kill_team_night',
   'Kill Team skirmishes on compact boards, so a game takes about 90 minutes and most people get two in. Bring a team, painted or not, and your own dice; terrain is already set up. Newer players get a walkthrough before the first game.'),
  ('evt_board_game_potluck',
   'Bring a game and bring a dish. The meeting room has a counter but no kitchen, so cold or room-temperature food works best. We eat first and then split into tables by whatever turned up. Families welcome, kids with an adult.'),
  ('evt_commander_precon',
   'Two pods of four, precon decks only — play one straight out of the box or make up to ten swaps. No infinite combos and no mass land destruction. If you do not own a precon, say so when you sign up and we will lend you one.'),
  ('evt_draft_set_release',
   'Draft the new set the week it lands: three packs each, three rounds, and you keep everything you open. Entry covers the packs. If you have never drafted, tell us and we will seat you next to someone who will talk through the picks.'),
  ('evt_dnd_gilded_fox',
   'A tomb-crawl one-shot for 5e, levels 4-6, with more traps and puzzles than fighting. Pre-made characters are available or bring your own at level 5. Roughly three and a half hours. Room 4A backs onto the quiet floor, so voices down.'),
  ('evt_wargame_intro',
   'No models, no rulebook, no problem. We hand you a small painted force and run a short demo so you can see how movement, shooting and morale actually work. About two hours, and nobody will ask you to buy anything afterwards.'),
  ('evt_family_game_hour',
   'An early, quieter session built for families. Games are chosen for ages six and up — Ticket to Ride First Journey, Sushi Go, Dragomino — and every table has someone who can teach. One adult per group, please. Runs about an hour.'),
  ('evt_commander_chaos',
   'Four pods of four with a house twist rolled at the start of each game: shared monarch, free mulligans, that sort of thing. Bring any Commander deck you like the look of. Power level is mid — not the night for a turn-three win.'),
  ('evt_draft_vintage_cube',
   'Powered singleton cube, 540 cards, eight seats. The cube belongs to the shop so there is nothing to bring but sleeves. The draft alone takes about 45 minutes and then we play three rounds, so plan on a long evening.'),
  ('evt_fest_warhammer_tourney',
   'Three rounds, 2000 points, matched play missions. Bring a printed list and a fully assembled army; painting is encouraged but not required. Tables and terrain are provided. Rounds run two hours with a short break between them.'),
  ('evt_fest_flagship_draft',
   'The big one: four pods of eight drafting at once, then three rounds inside your pod. Packs are included and you keep your cards. Seating closes when the last pod fills, so get there by 6:15 if you want a specific table.'),
  ('evt_fest_commander_gauntlet',
   'Five pods, three rounds, and you change table between each one. Bring a single deck and stick with it. Mid power is the sweet spot — upgraded precons and homebrews. Winners of each pod meet at the final table to close it out.'),
  ('evt_fest_dnd_marathon',
   'One long 5e adventure run straight through, roughly five hours with a break in the middle. Levels 5-8; pre-made characters are provided if you would rather not build one. Two tables run the same story, so the endings differ.'),
  ('evt_fest_board_library',
   'Several hundred games on open shelves. Borrow any of them for the evening and return it to the cart when you are done. Volunteers circulate to teach. No ticket beyond a seat here — come for twenty minutes or stay until we pack up.'),
  ('evt_fest_learn_anything',
   'Tell a volunteer roughly what you are in the mood for and they will find a game and teach it, from ten-minute card games to a two-hour Euro. Built for the people who came with a friend who plays and have no idea where to start.'),
  ('evt_fest_sealed_finals',
   'Six packs each, 30 minutes to build a 40-card deck, then five rounds of Swiss to close the weekend. Open to anyone, not just the festival regulars. Deck-building help is on hand for first-timers, and you keep everything you open.'),
  ('evt_fest_indie_rpg',
   'Short demos of small-press roleplaying games — Blades in the Dark, Honey Heist, Brindlewood Bay — in 45-minute slots, so you can try three in one evening. Everything is provided and no system knowledge is assumed.'),
  ('evt_fest_closing_pods',
   'The last thing that happens at the festival. Three pods, one game each, nobody keeping score. Bring whichever deck you have been carrying all weekend. We start late and finish when the games finish, so do not plan anything after.'),
  ('evt_kids_board_club',
   'For ages eight to thirteen, with a parent or carer staying in the room. We play in short rounds so nobody is stuck in a two-hour game, and tables rotate halfway through. Library rules apply, which means water only, no snacks.'),
  ('evt_warhammer_narrative',
   'Session one of a six-week narrative campaign. Bring a 1000-point force you are happy to keep playing, because it will gain and lose things as the story goes. Losing a battle never knocks you out, and missing a week is fine.'),
  ('evt_draft_two_headed',
   'Two-Headed Giant draft: pick a teammate, draft side by side, then play as one. Turn up alone and we will pair you with someone else who did. Six teams, three rounds, packs included. The friendliest draft format we run.'),
  ('evt_dnd_west_marches',
   'Session twelve of an ongoing West Marches game. The table changes week to week, so new characters can join at level 6 — bring a sheet and a reason to be heading into the hills. We recap at the start; nothing to read in advance.'),
  ('evt_library_game_day',
   'An all-evening open table in Room 2B. We bring about sixty games, teach anything on the shelf, and seat anyone arriving alone at a table that needs one more. Free, no ticket, and you can leave whenever your game ends.'),
  ('evt_league_finals_draft',
   'The last night of the eight-week draft league. Standings carry in and the top four seats play for the prize pool. Finals seats are for league members, but anyone is welcome to come and watch the last round with the rest of us.'),
  ('evt_warhammer_doubles',
   'Two players a side, 1000 points each, activations alternating across the pair. Bring a partner or let us match you with one on the night. Three short games over the evening, and the terrain stays set between rounds.'),
  ('evt_puzzle_night',
   'Co-operative games only — everyone wins or everyone loses. We run The Crew, Mysterium and one longer escape-room box, and nobody is eliminated from anything. Good if competitive tables put you off. About two and a half hours.'),
  ('evt_dnd_saltmarsh',
   'A nautical 5e campaign, five sessions in and running at level 5. One seat has opened up, so a new character can join this week. Bring a sheet, or ask and we will help you roll one up before we start.'),
  ('evt_board_heavy_euro',
   'Long games with long rulebooks: Brass, Gaia Project, Arcs and whatever else people carry up the stairs. Rules are taught but the teaching is not short, so come at 6:30 if you need one. Expect to play one game, not three.'),
  ('evt_commander_cedh',
   'Competitive Commander practice pods ahead of the regional. Optimised lists, fast combos and turn-three wins expected — this is the one night we do not ask anyone to pull their punches. Two pods of four, proxies are fine.'),
  ('evt_dnd_beginners',
   'For people who have never played a roleplaying game and are not yet sure they want to. We explain what the dice do, hand you a character and run a short adventure. Two hours, nothing to bring, no commitment to come back.'),
  ('evt_warhammer_paint',
   'Bring models and brushes; we bring the tables, the lamps and a bottle of thinner to share. Half the room paints and half plays, and people swap over during the evening. No skill level assumed — someone will show you the basics.'),
  ('evt_trivia_night',
   'Six rounds of tabletop trivia: game history, rules minutiae, box art, dice odds. Teams of up to four, and if you turn up alone we will find you a team. About two hours, and the winning table picks a game off the shelf to keep.'),
  ('evt_draft_team_league',
   'Teams of three draft against each other and then play their opposite number. Sign up as a team or as a free agent and we will build a team around you. Six weeks, one night each, and you can miss a week without dropping out.'),
  ('evt_board_game_swap',
   'Bring games you no longer play and take home games someone else no longer plays. No money changes hands. Please check that every box is complete before you bring it, and be ready to take home anything nobody claims.'),
  ('evt_commander_cracked_packs',
   'Everyone opens the same set of packs, builds a Commander deck out of what they get, and then plays a pod. Chaotic, and almost no advantage to owning expensive cards. Building takes about 40 minutes, then one long game.'),
  ('evt_dnd_campaign_finale',
   'The last session of a campaign that has run for two years. Players from earlier arcs are welcome back for the ending even if you have not been at the table in months — bring your old sheet. Expect a long night, and cake.'),
  -- past ---------------------------------------------------------------------
  ('evt_last_week_draft',
   'The regular Friday eight-person draft: three packs each, three rounds of Swiss, and everyone keeps what they open. Packs were included in entry and the shop put up store credit for the top two finishers.'),
  ('evt_past_commander_league',
   'Week six of the Commander league. Three pods, points for wins and for a handful of silly bonus objectives, all carried into the standings. Mid power decks, and the same pods stayed together for the whole evening.'),
  ('evt_past_board_brunch',
   'A slower, lighter session with coffee and pastries at the back of the room. Shorter games, plenty of teaching, and tables people drifted in and out of. Good for anyone who finds a full games night too much at once.'),
  ('evt_past_dnd_icespire',
   'Session four of Dragon of Icespire Peak, levels 3-4. A closed table: the same six players ran the campaign from the start, so the seats were spoken for from session one. Listed here so the campaign record stays complete.'),
  ('evt_past_learn_rpg',
   'One evening that took people from never having rolled a d20 to finishing a short adventure. Characters, dice and a two-page rules sheet were all supplied, and nobody had to read anything in advance.'),
  ('evt_past_autumn_swap',
   'An end-of-summer swap: bring what you no longer play, leave with something you have not tried, no money involved. Boxes were checked for missing pieces on the way in and the leftovers went to the library donation shelf.'),
  -- cancelled ----------------------------------------------------------------
  ('evt_cancel_late_pod',
   'A late pod for people who finish work after everyone else has already started. Two tables of four, casual decks, and we go until the building closes. Sign up so we know whether to hold the back tables for you.'),
  ('evt_cancel_grand_melee',
   'A six-player free-for-all on one very large table, 750 points each, last army standing. Bring a force you do not mind losing badly with. Terrain is provided, and the melee usually takes about three hours to resolve.'),
  ('evt_cancel_frostmaiden',
   'Session one of Rime of the Frostmaiden, 5e, starting at level 1 and meant to run for months. New characters only — build one in advance or come early and we will do it together. Expect cold, dark and a slow burn.'),
  ('evt_cancel_board_marathon',
   'Games from six until the building closes, opening with short fillers and ending on whatever heavy box is still on the table. Bring something off your own shelf if you want it taught. Come for an hour or for the whole evening.'),
  ('evt_cancel_midsummer',
   'An outdoor social: lawn games, card games on picnic blankets, nothing that needs a table. Family friendly and free. Bring a blanket and something to drink. Building 30 has the shelter if the weather turns on us.')
)
UPDATE events
   SET description = (SELECT body FROM descriptions d WHERE d.id = events.id)
 WHERE id IN (SELECT id FROM descriptions);

-- ---------------------------------------------------------------- rsvps ----
-- created_at is staggered so the attendee list has a stable, meaningful order.
--
-- The seven original events keep their hand-written RSVP rows: each one encodes
-- a guarantee (FULL, one seat left, empty, Alice present or absent) that a
-- generator would obscure. Everything after them is generated — see the block
-- below the curated rows.

-- Friday Night Draft — 5/8 (3 seats left)
INSERT INTO rsvps (event_id, player_id, created_at) VALUES
  ('evt_friday_draft', 'u_alice', strftime('%Y-%m-%dT%H:%M:%SZ','now','-50 hours')),
  ('evt_friday_draft', 'u_bob',   strftime('%Y-%m-%dT%H:%M:%SZ','now','-49 hours')),
  ('evt_friday_draft', 'u_chen',  strftime('%Y-%m-%dT%H:%M:%SZ','now','-32 hours')),
  ('evt_friday_draft', 'u_dana',  strftime('%Y-%m-%dT%H:%M:%SZ','now','-20 hours')),
  ('evt_friday_draft', 'u_eli',   strftime('%Y-%m-%dT%H:%M:%SZ','now','-6 hours'));

-- Commander Pod Night — 4/4, FULL
INSERT INTO rsvps (event_id, player_id, created_at) VALUES
  ('evt_commander_pod', 'u_alice', strftime('%Y-%m-%dT%H:%M:%SZ','now','-70 hours')),
  ('evt_commander_pod', 'u_farah', strftime('%Y-%m-%dT%H:%M:%SZ','now','-68 hours')),
  ('evt_commander_pod', 'u_gus',   strftime('%Y-%m-%dT%H:%M:%SZ','now','-40 hours')),
  ('evt_commander_pod', 'u_hana',  strftime('%Y-%m-%dT%H:%M:%SZ','now','-9 hours'));

-- D&D One-Shot — 4/5, one seat left. Alice is deliberately NOT in this one:
-- it is the "two browser profiles race for the last seat" demo.
INSERT INTO rsvps (event_id, player_id, created_at) VALUES
  ('evt_dnd_sunken_vault', 'u_bob',  strftime('%Y-%m-%dT%H:%M:%SZ','now','-30 hours')),
  ('evt_dnd_sunken_vault', 'u_chen', strftime('%Y-%m-%dT%H:%M:%SZ','now','-28 hours')),
  ('evt_dnd_sunken_vault', 'u_dana', strftime('%Y-%m-%dT%H:%M:%SZ','now','-27 hours')),
  ('evt_dnd_sunken_vault', 'u_eli',  strftime('%Y-%m-%dT%H:%M:%SZ','now','-4 hours'));

-- Board Game Meetup — 2/12
INSERT INTO rsvps (event_id, player_id, created_at) VALUES
  ('evt_board_game_meetup', 'u_farah', strftime('%Y-%m-%dT%H:%M:%SZ','now','-15 hours')),
  ('evt_board_game_meetup', 'u_gus',   strftime('%Y-%m-%dT%H:%M:%SZ','now','-2 hours'));

-- Warhammer 40k Open Play — 0/6, the empty-but-open case.

-- Learn to Play Magic — 3/10
INSERT INTO rsvps (event_id, player_id, created_at) VALUES
  ('evt_learn_magic', 'u_alice', strftime('%Y-%m-%dT%H:%M:%SZ','now','-26 hours')),
  ('evt_learn_magic', 'u_hana',  strftime('%Y-%m-%dT%H:%M:%SZ','now','-24 hours')),
  ('evt_learn_magic', 'u_bob',   strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 hours'));

-- Last Week's Draft — 6/8, in the past
INSERT INTO rsvps (event_id, player_id, created_at) VALUES
  ('evt_last_week_draft', 'u_alice', strftime('%Y-%m-%dT%H:%M:%SZ','now','-10 days')),
  ('evt_last_week_draft', 'u_bob',   strftime('%Y-%m-%dT%H:%M:%SZ','now','-10 days')),
  ('evt_last_week_draft', 'u_chen',  strftime('%Y-%m-%dT%H:%M:%SZ','now','-9 days')),
  ('evt_last_week_draft', 'u_dana',  strftime('%Y-%m-%dT%H:%M:%SZ','now','-8 days')),
  ('evt_last_week_draft', 'u_eli',   strftime('%Y-%m-%dT%H:%M:%SZ','now','-8 days')),
  ('evt_last_week_draft', 'u_farah', strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 days'));

-- --------------------------------------------------- generated attendance --
-- Roughly 400 RSVP rows for the 57 events added above, written as ONE set-based
-- insert rather than 400 hand-typed lines. Hand-writing them would be unreadable
-- and impossible to keep consistent with capacity; this is a table of intent.
--
-- How it works, in one sentence: `fill` names, per event, how many seats are
-- `taken` and by how far to rotate (`skip`) into the players list, and the join
-- picks the players whose rotated index falls under `taken`.
--
-- The properties that matter:
--
--   * **Deterministic.** No `random()` anywhere. The same seed run twice gives
--     the same attendee lists, so a screenshot, a test, or a bug report stays
--     reproducible across reseeds.
--   * **Capacity-safe.** Every `taken` below is <= that event's capacity and <=
--     the number of players (28). If either were violated the derived
--     `rsvp_count` UPDATE at the foot of this file would fail the
--     `rsvp_count <= capacity` CHECK — which is the check doing its job, not a
--     seed bug to work around.
--   * **Alice is a switch.** Players are numbered by `ORDER BY id`, and
--     `u_alice` sorts first (n = 0), so Alice is in an event exactly when
--     `skip < taken`. That is how her spread below is chosen on purpose: about
--     a dozen upcoming events, three past ones, and `evt_cancel_late_pod`.
--   * **created_at is relative to the event**, not to now, so a signup never
--     post-dates the game it is for: the earliest lands `taken * 4 + 24` hours
--     before kick-off and each subsequent one four hours later, giving every
--     attendee list a stable, meaningful order.
--
-- Events absent from `fill` have zero RSVPs on purpose: Pauper League Week 3,
-- Kids Board Game Club, cEDH Practice Pods and Board Game Marathon (cancelled)
-- are the empty-but-open / empty-and-cancelled cases.
--
-- Fill levels are spread deliberately: FULL (taken = capacity) on Kill Team
-- Skirmish Night, Chaos Commander, Game Fest Sealed Finals, West Marches,
-- Team Draft League and the past Icespire session; one-seat-left on
-- D&D Amberfall, Precon Commander, Game Fest Commander Gauntlet, Narrative
-- Warhammer, Paint and Play and the past Thursday Draft; the rest run from
-- 1/16 to 26/40.
WITH players AS (
  SELECT id,
         ROW_NUMBER() OVER (ORDER BY id) - 1 AS n,
         (SELECT COUNT(*) FROM users WHERE role = 'player') AS total
    FROM users
   WHERE role = 'player'
),
fill (event_id, taken, skip) AS (VALUES
  -- upcoming ----------------------------------------------------------------
  ('evt_midweek_modern',           9, 12),
  ('evt_dnd_curse_amber',          5,  0),   -- 5/6, one seat left
  ('evt_catan_tournament',        12, 15),
  ('evt_kill_team_night',          8, 10),   -- 8/8, FULL
  ('evt_board_game_potluck',      14,  1),
  ('evt_commander_precon',         7,  9),   -- 7/8, one seat left
  ('evt_draft_set_release',        6,  4),
  ('evt_dnd_gilded_fox',           3, 11),
  ('evt_wargame_intro',            1, 20),
  ('evt_family_game_hour',        17, 18),
  ('evt_commander_chaos',         16, 20),   -- 16/16, FULL
  ('evt_rpg_open_table',           4,  0),
  ('evt_draft_vintage_cube',       5, 13),
  ('evt_fest_warhammer_tourney',  11, 15),
  ('evt_fest_flagship_draft',     24, 25),
  ('evt_fest_commander_gauntlet', 19, 22),   -- 19/20, one seat left
  ('evt_fest_dnd_marathon',        6,  1),
  ('evt_fest_board_library',      26, 26),   -- the fullest room on the board
  ('evt_fest_learn_anything',      9, 12),
  ('evt_fest_sealed_finals',      16, 17),   -- 16/16, FULL
  ('evt_fest_indie_rpg',           5, 21),
  ('evt_fest_closing_pods',        3,  0),
  ('evt_warhammer_narrative',      5, 17),   -- 5/6, one seat left
  ('evt_draft_two_headed',         8, 11),
  ('evt_commander_budget',         2, 22),
  ('evt_dnd_west_marches',         6,  1),   -- 6/6, FULL
  ('evt_library_game_day',        21, 24),
  ('evt_league_finals_draft',     13,  0),
  ('evt_warhammer_doubles',        4, 14),
  ('evt_puzzle_night',             7, 25),
  ('evt_dnd_saltmarsh',            2, 19),
  ('evt_board_heavy_euro',         6, 10),
  ('evt_draft_chaos_cube',         3,  2),
  ('evt_dnd_beginners',           10, 13),
  ('evt_warhammer_paint',          9,  1),   -- 9/10, one seat left
  ('evt_trivia_night',            12, 16),
  ('evt_draft_team_league',       12, 14),   -- 12/12, FULL
  ('evt_board_game_swap',          5, 23),
  ('evt_commander_cracked_packs',  8,  9),
  ('evt_dnd_campaign_finale',      3,  0),
  ('evt_prerelease_draft',         1, 26),   -- five weeks out, one brave soul
  -- past --------------------------------------------------------------------
  ('evt_past_commander_league',    9,  1),
  ('evt_past_board_brunch',       13,  4),
  ('evt_past_dnd_icespire',        6,  3),   -- 6/6, FULL, and finished
  ('evt_past_warhammer_league',    5, 11),
  ('evt_past_thursday_draft',      7,  2),   -- 7/8, one seat left, and finished
  ('evt_past_learn_rpg',           6, 20),
  ('evt_past_autumn_swap',        15,  0),
  -- cancelled ---------------------------------------------------------------
  ('evt_cancel_late_pod',          4,  0),   -- Alice is in this one, on purpose
  ('evt_cancel_grand_melee',       7,  5),
  ('evt_cancel_frostmaiden',       2,  9),
  ('evt_cancel_snow_draft',        3,  7),
  ('evt_cancel_midsummer',        11,  2)
)
INSERT INTO rsvps (event_id, player_id, created_at)
SELECT f.event_id,
       p.id,
       strftime('%Y-%m-%dT%H:%M:%SZ', e.starts_at,
                '-' || (f.taken * 4 + 24 - ((p.n + f.skip) % p.total) * 4) || ' hours')
  FROM fill f
  JOIN events e ON e.id = f.event_id
  JOIN players p ON ((p.n + f.skip) % p.total) < f.taken;

-- Single source of truth for the projection: derive it, never hand-count it.
UPDATE events SET rsvp_count = (SELECT COUNT(*) FROM rsvps WHERE rsvps.event_id = events.id);
