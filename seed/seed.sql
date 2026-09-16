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
-- **The venues are real; everything else is invented.** The four events below
-- with place columns are pinned to genuine public civic facilities in Seattle —
-- a central library, a branch library, a community centre and a city park —
-- because a demo board full of maps of nowhere proves nothing, and because a
-- public building cannot be misrepresented by a fictional game night the way a
-- named private business could. The organizers, the players, the games and the
-- room numbers are all made up.
--
-- Coordinates and addresses are hard-coded, never fetched: `pnpm db:reset:local`
-- must work offline, with no API key, and cost nothing. The `place_id` values
-- are deliberately obvious placeholders (`seed_place_…`) rather than
-- real-looking `ChIJ…` strings — a fabricated id in Google's own format would be
-- a small lie sitting in the database waiting to be trusted. They behave
-- correctly everywhere it matters: the mini map is rendered from the
-- coordinates, and `?v=` only has to match the stored value.
--
-- Three events keep NULL place columns on purpose. That is not laziness, it is
-- the other half of the feature: a back room, a house game and a shop that is
-- not in anyone's index all have to stay postable and readable, and a reviewer
-- should see both modes on one screen.
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
  -- No verified place: a fictional shop, exactly as an organizer would type it.
  ('evt_friday_draft', 'org_cardboard', 'Friday Night Draft', 'magic_draft',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+2 days','+20 hours','+7 hours'),
   'Cardboard Castle, 114 Pike St', 8, 0, lower(hex(randomblob(8))),
   NULL, NULL, NULL, NULL, NULL),

  -- No verified place.
  ('evt_commander_pod', 'org_cardboard', 'Commander Pod Night', 'commander',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+3 days','+19.5 hours','+7 hours'),
   'Cardboard Castle, 114 Pike St', 4, 0, lower(hex(randomblob(8))),
   NULL, NULL, NULL, NULL, NULL),

  -- Seattle Central Library (real public library). The label keeps the room
  -- number the organizer cares about; the address is Google's canonical form.
  ('evt_dnd_sunken_vault', 'org_metro', 'D&D One-Shot: The Sunken Vault', 'dnd',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+4 days','+19.5 hours','+7 hours'),
   'Central Library, Room 2B', 5, 0, lower(hex(randomblob(8))),
   'seed_place_spl_central', '1000 4th Ave, Seattle, WA 98104, USA', 47.6067, -122.3325,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- Seattle Public Library, Ballard Branch (real public library).
  ('evt_board_game_meetup', 'org_metro', 'Board Game Meetup', 'board_games',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+6 days','+19 hours','+7 hours'),
   'Ballard Library, meeting room', 12, 0, lower(hex(randomblob(8))),
   'seed_place_spl_ballard', '5614 22nd Ave NW, Seattle, WA 98107, USA', 47.6686, -122.3856,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- Green Lake Community Center (real city community centre).
  ('evt_warhammer_open', 'org_metro', 'Warhammer 40k Open Play', 'warhammer',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+9 days','+18.5 hours','+7 hours'),
   'Green Lake Community Center, main hall', 6, 0, lower(hex(randomblob(8))),
   'seed_place_greenlake_cc', '7201 E Green Lake Dr N, Seattle, WA 98115, USA', 47.6807, -122.3283,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- Warren G. Magnuson Park (real city park). Proves the search join: nothing in
  -- the typed label says "Sand Point", but ?q=Sand Point finds this event.
  ('evt_learn_magic', 'org_cardboard', 'Learn to Play Magic', 'other',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+14 days','+20.5 hours','+7 hours'),
   'Magnuson Park, Building 30', 10, 0, lower(hex(randomblob(8))),
   'seed_place_magnuson_park', '7400 Sand Point Way NE, Seattle, WA 98115, USA', 47.6806, -122.2570,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- Past event: must never appear in the upcoming list, and RSVPs to it 409.
  -- No verified place.
  ('evt_last_week_draft', 'org_cardboard', 'Last Week''s Draft', 'magic_draft',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','-3 days','+20 hours','+7 hours'),
   'Cardboard Castle, 114 Pike St', 8, 0, lower(hex(randomblob(8))),
   NULL, NULL, NULL, NULL, NULL);

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
-- Place columns are NULL on all but two of these. The keyless venue is the
-- normal case and should dominate the board; two events reuse a seeded real
-- place id so a reviewer scrolling the list still meets a map without hunting.
INSERT INTO events (id, organizer_id, title, game_type, starts_at, location, capacity, rsvp_count, room_key,
                    place_id, place_address, place_lat, place_lng, place_resolved_at) VALUES
  -- +1 day (2)
  ('evt_midweek_modern', 'org_cardboard', 'Midweek Modern Night', 'other',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+1 days','+19.5 hours','+7 hours'),
   'Cardboard Castle, 114 Pike St', 16, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),
  ('evt_dnd_curse_amber', 'org_metro', 'D&D: The Curse of Amberfall', 'dnd',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+1 days','+23 hours','+7 hours'),
   'Greenwood House, dining room', 6, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),

  -- +2 days (2 more, alongside Friday Night Draft)
  ('evt_catan_tournament', 'org_dicegoblin', 'Catan Tournament', 'board_games',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+2 days','+19 hours','+7 hours'),
   'Dice Goblin Loft, 3rd floor', 16, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),
  ('evt_kill_team_night', 'org_metro', 'Kill Team Skirmish Night', 'warhammer',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+2 days','+20.5 hours','+7 hours'),
   'Green Lake Community Center, main hall', 8, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),

  -- +3 days (1 more)
  ('evt_pauper_league', 'org_cardboard', 'Pauper League Week 3', 'other',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+3 days','+21 hours','+7 hours'),
   'Cardboard Castle, 114 Pike St', 12, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),

  -- +4 days (2 more)
  ('evt_board_game_potluck', 'org_library', 'Board Game Potluck', 'board_games',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+4 days','+18.5 hours','+7 hours'),
   'Ballard Library, meeting room', 20, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),
  ('evt_commander_precon', 'org_dicegoblin', 'Precon Commander Night', 'commander',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+4 days','+20.5 hours','+7 hours'),
   'Dice Goblin Loft, back tables', 8, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),

  -- +6 days (3 more)
  ('evt_draft_set_release', 'org_cardboard', 'Booster Draft: Set Release', 'magic_draft',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+6 days','+20 hours','+7 hours'),
   'Cardboard Castle, 114 Pike St', 8, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),
  ('evt_dnd_gilded_fox', 'org_metro', 'D&D One-Shot: Tomb of the Gilded Fox', 'dnd',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+6 days','+22 hours','+7 hours'),
   'Central Library, Room 4A', 6, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),
  ('evt_wargame_intro', 'org_library', 'Intro to Miniature Wargaming', 'warhammer',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+6 days','+18.5 hours','+7 hours'),
   'Magnuson Park, Building 30', 10, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),

  -- +7 days (1)
  ('evt_family_game_hour', 'org_library', 'Family Game Hour', 'board_games',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+7 days','+18 hours','+7 hours'),
   'Ballard Library, meeting room', 24, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),

  -- +9 days (2 more, alongside Warhammer 40k Open Play)
  ('evt_commander_chaos', 'org_dicegoblin', 'Chaos Commander: Four-Player Pods', 'commander',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+9 days','+19.5 hours','+7 hours'),
   'Dice Goblin Loft, 3rd floor', 16, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),
  ('evt_rpg_open_table', 'org_metro', 'Open Table RPG Night', 'dnd',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+9 days','+21 hours','+7 hours'),
   'Greenwood House, dining room', 7, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),

  -- +10 days (1)
  ('evt_draft_vintage_cube', 'org_cardboard', 'Vintage Cube Draft', 'magic_draft',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+10 days','+20 hours','+7 hours'),
   'Cardboard Castle, 114 Pike St', 8, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),

  -- +12 days — Game Fest, day one (4). One venue, four staggered slots.
  ('evt_fest_warhammer_tourney', 'org_library', 'Game Fest: Warhammer 40k Tournament', 'warhammer',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+12 days','+18 hours','+7 hours'),
   'Magnuson Park, Building 30', 16, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),
  ('evt_fest_flagship_draft', 'org_cardboard', 'Game Fest: Flagship Draft', 'magic_draft',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+12 days','+18.5 hours','+7 hours'),
   'Magnuson Park, Building 30', 32, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),
  ('evt_fest_commander_gauntlet', 'org_dicegoblin', 'Game Fest: Commander Gauntlet', 'commander',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+12 days','+19.5 hours','+7 hours'),
   'Magnuson Park, Building 30', 20, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),
  ('evt_fest_dnd_marathon', 'org_metro', 'Game Fest: D&D Marathon', 'dnd',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+12 days','+20.5 hours','+7 hours'),
   'Magnuson Park, Building 30', 8, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),

  -- +13 days — Game Fest, day two (5). The heaviest day on the board; the
  -- open library is the one event here that carries a verified place.
  ('evt_fest_board_library', 'org_library', 'Game Fest: Open Board Game Library', 'board_games',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+13 days','+18 hours','+7 hours'),
   'Magnuson Park, Building 30', 40, 0, lower(hex(randomblob(8))),
   'seed_place_magnuson_park', '7400 Sand Point Way NE, Seattle, WA 98115, USA', 47.6806, -122.2570,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('evt_fest_learn_anything', 'org_cardboard', 'Game Fest: Learn to Play Anything', 'other',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+13 days','+19 hours','+7 hours'),
   'Magnuson Park, Building 30', 24, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),
  ('evt_fest_sealed_finals', 'org_cardboard', 'Game Fest: Sealed Finals', 'magic_draft',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+13 days','+20 hours','+7 hours'),
   'Magnuson Park, Building 30', 16, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),
  ('evt_fest_indie_rpg', 'org_metro', 'Game Fest: Indie RPG Showcase', 'dnd',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+13 days','+21 hours','+7 hours'),
   'Magnuson Park, Building 30', 12, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),
  ('evt_fest_closing_pods', 'org_dicegoblin', 'Game Fest: Closing Commander Pods', 'commander',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+13 days','+23 hours','+7 hours'),
   'Magnuson Park, Building 30', 12, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),

  -- +14 days (2 more, alongside Learn to Play Magic)
  ('evt_kids_board_club', 'org_library', 'Kids Board Game Club', 'board_games',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+14 days','+18.5 hours','+7 hours'),
   'Ballard Library, meeting room', 18, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),
  ('evt_warhammer_narrative', 'org_metro', 'Narrative Warhammer Campaign, Session 1', 'warhammer',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+14 days','+20 hours','+7 hours'),
   'Green Lake Community Center, main hall', 6, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),

  -- +16 days (1)
  ('evt_draft_two_headed', 'org_cardboard', 'Two-Headed Giant Draft', 'magic_draft',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+16 days','+19.5 hours','+7 hours'),
   'Cardboard Castle, 114 Pike St', 12, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),

  -- +17 days (2)
  ('evt_commander_budget', 'org_dicegoblin', 'Budget Commander Brawl', 'commander',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+17 days','+20.5 hours','+7 hours'),
   'Dice Goblin Loft, back tables', 8, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),
  ('evt_dnd_west_marches', 'org_metro', 'West Marches: Session 12', 'dnd',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+17 days','+22 hours','+7 hours'),
   'Greenwood House, dining room', 6, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),

  -- +19 days — league finals night (4), three organizers running at once.
  ('evt_library_game_day', 'org_library', 'Library Game Day', 'board_games',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+19 days','+18 hours','+7 hours'),
   'Central Library, Room 2B', 30, 0, lower(hex(randomblob(8))),
   'seed_place_spl_central', '1000 4th Ave, Seattle, WA 98104, USA', 47.6067, -122.3325,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('evt_league_finals_draft', 'org_cardboard', 'Draft League Finals', 'magic_draft',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+19 days','+19 hours','+7 hours'),
   'Cardboard Castle, 114 Pike St', 16, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),
  ('evt_warhammer_doubles', 'org_metro', 'Warhammer Doubles Night', 'warhammer',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+19 days','+20 hours','+7 hours'),
   'Green Lake Community Center, main hall', 8, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),
  ('evt_puzzle_night', 'org_dicegoblin', 'Co-op Puzzle Night', 'other',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+19 days','+21 hours','+7 hours'),
   'Dice Goblin Loft, 3rd floor', 10, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),

  -- +20 days (1)
  ('evt_dnd_saltmarsh', 'org_metro', 'D&D: Saltmarsh Pirates', 'dnd',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+20 days','+19.5 hours','+7 hours'),
   'Greenwood House, dining room', 6, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),

  -- +22 days (2)
  ('evt_board_heavy_euro', 'org_dicegoblin', 'Heavy Euro Games Evening', 'board_games',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+22 days','+18.5 hours','+7 hours'),
   'Dice Goblin Loft, 3rd floor', 12, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),
  ('evt_draft_chaos_cube', 'org_cardboard', 'Chaos Cube Draft', 'magic_draft',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+22 days','+20 hours','+7 hours'),
   'Cardboard Castle, 114 Pike St', 8, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),

  -- +24 days (1)
  ('evt_commander_cedh', 'org_dicegoblin', 'cEDH Practice Pods', 'commander',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+24 days','+20.5 hours','+7 hours'),
   'Dice Goblin Loft, back tables', 8, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),

  -- +26 days (3)
  ('evt_dnd_beginners', 'org_library', 'D&D for Absolute Beginners', 'dnd',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+26 days','+18.5 hours','+7 hours'),
   'Ballard Library, meeting room', 12, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),
  ('evt_warhammer_paint', 'org_metro', 'Paint and Play Warhammer', 'warhammer',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+26 days','+19.5 hours','+7 hours'),
   'Green Lake Community Center, main hall', 10, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),
  ('evt_trivia_night', 'org_cardboard', 'Tabletop Trivia Night', 'other',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+26 days','+21 hours','+7 hours'),
   'Cardboard Castle, 114 Pike St', 20, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),

  -- +27 days (1)
  ('evt_draft_team_league', 'org_cardboard', 'Team Draft League', 'magic_draft',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+27 days','+20 hours','+7 hours'),
   'Cardboard Castle, 114 Pike St', 12, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),

  -- +30 days (1)
  ('evt_board_game_swap', 'org_library', 'Board Game Swap Meet', 'board_games',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+30 days','+18 hours','+7 hours'),
   'Central Library, Room 2B', 25, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),

  -- +33 days (2)
  ('evt_commander_cracked_packs', 'org_dicegoblin', 'Commander Cracked Packs', 'commander',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+33 days','+20.5 hours','+7 hours'),
   'Dice Goblin Loft, 3rd floor', 16, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),
  ('evt_dnd_campaign_finale', 'org_metro', 'D&D Campaign Finale', 'dnd',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+33 days','+22 hours','+7 hours'),
   'Greenwood House, dining room', 6, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),

  -- +35 days (1) — the far edge of the five-week window, barely signed up yet.
  ('evt_prerelease_draft', 'org_cardboard', 'Set Prerelease Draft', 'magic_draft',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+35 days','+19.5 hours','+7 hours'),
   'Cardboard Castle, 114 Pike St', 16, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL);

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
  ('evt_past_commander_league', 'org_dicegoblin', 'Commander League Night', 'commander',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','-2 days','+20.5 hours','+7 hours'),
   'Dice Goblin Loft, 3rd floor', 12, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),
  ('evt_past_board_brunch', 'org_library', 'Board Game Brunch', 'board_games',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','-2 days','+18.5 hours','+7 hours'),
   'Ballard Library, meeting room', 20, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),
  -- Ran full. A past FULL event is its own small regression test: the seat bar
  -- and the "FULL" badge have to render for an event nobody can join any more.
  ('evt_past_dnd_icespire', 'org_metro', 'D&D: Dragon of Icespire, Session 4', 'dnd',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','-4 days','+22 hours','+7 hours'),
   'Greenwood House, dining room', 6, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),
  ('evt_past_warhammer_league', 'org_metro', 'Warhammer League Round 2', 'warhammer',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','-6 days','+19.5 hours','+7 hours'),
   'Green Lake Community Center, main hall', 8, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),
  ('evt_past_thursday_draft', 'org_cardboard', 'Thursday Draft', 'magic_draft',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','-8 days','+20 hours','+7 hours'),
   'Cardboard Castle, 114 Pike St', 8, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),
  ('evt_past_learn_rpg', 'org_library', 'Learn an RPG in One Night', 'other',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','-11 days','+19 hours','+7 hours'),
   'Central Library, Room 4A', 15, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL),
  ('evt_past_autumn_swap', 'org_library', 'Autumn Game Swap', 'board_games',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','-16 days','+18 hours','+7 hours'),
   'Magnuson Park, Building 30', 24, 0, lower(hex(randomblob(8))), NULL, NULL, NULL, NULL, NULL);

-- ------------------------------------------------------- cancelled events --
-- Cancellation is a status, not a delete (see 0002_admin.sql), and the seed has
-- to show that. Four upcoming and two past:
--
--   * `evt_cancel_late_pod` is the important one. Alice holds a seat on it, so
--     "My events" renders a cancelled card — the case `listPlayerRsvps` is
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
  ('evt_cancel_late_pod', 'org_dicegoblin', 'Late Night Commander Pod', 'commander',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+7 days','+21 hours','+7 hours'),
   'Dice Goblin Loft, back tables', 8, 0, lower(hex(randomblob(8))),
   'cancelled', strftime('%Y-%m-%dT%H:%M:%SZ','now','-2 days'),
   NULL, NULL, NULL, NULL, NULL),
  ('evt_cancel_grand_melee', 'org_metro', 'Warhammer Grand Melee', 'warhammer',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+13 days','+19 hours','+7 hours'),
   'Green Lake Community Center, main hall', 12, 0, lower(hex(randomblob(8))),
   'cancelled', strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 days'),
   NULL, NULL, NULL, NULL, NULL),
  ('evt_cancel_frostmaiden', 'org_metro', 'D&D: Rime of the Frostmaiden, Session 1', 'dnd',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+20 days','+20.5 hours','+7 hours'),
   'Greenwood House, dining room', 6, 0, lower(hex(randomblob(8))),
   'cancelled', strftime('%Y-%m-%dT%H:%M:%SZ','now','-6 hours'),
   NULL, NULL, NULL, NULL, NULL),
  ('evt_cancel_board_marathon', 'org_library', 'Board Game Marathon', 'board_games',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','+26 days','+18 hours','+7 hours'),
   'Ballard Library, meeting room', 20, 0, lower(hex(randomblob(8))),
   'cancelled', strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 days'),
   NULL, NULL, NULL, NULL, NULL),
  ('evt_cancel_snow_draft', 'org_cardboard', 'Snow Day Draft', 'magic_draft',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','-5 days','+20 hours','+7 hours'),
   'Cardboard Castle, 114 Pike St', 8, 0, lower(hex(randomblob(8))),
   'cancelled', strftime('%Y-%m-%dT%H:%M:%SZ','now','-6 days'),
   NULL, NULL, NULL, NULL, NULL),
  ('evt_cancel_midsummer', 'org_metro', 'Midsummer Game Social', 'other',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 hours','start of day','-12 days','+19.5 hours','+7 hours'),
   'Magnuson Park, Building 30', 30, 0, lower(hex(randomblob(8))),
   'cancelled', strftime('%Y-%m-%dT%H:%M:%SZ','now','-14 days'),
   NULL, NULL, NULL, NULL, NULL);

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
