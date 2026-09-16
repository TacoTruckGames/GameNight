-- Game Night — demo seed data.
--
-- Idempotent: wipes the three tables first, so it can be re-run any number of
-- times. Dates are relative to "now" (SQLite `strftime`), so a freshly seeded
-- board always has upcoming events, exactly one FULL event, one event that is
-- one seat from full (the race demo), and one past event that the upcoming
-- filter must hide. `pnpm dev` re-seeds on every start on purpose.
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
-- 8 players + 2 organizers + 1 admin. Organizers are seed-only in spirit and
-- the admin is seed-only by construction: `SIGNUP_ROLES` excludes it, so
-- POST /api/users can never create one.
INSERT INTO users (id, name, role) VALUES
  ('u_alice', 'Alice',  'player'),
  ('u_bob',   'Bob',    'player'),
  ('u_chen',  'Chen',   'player'),
  ('u_dana',  'Dana',   'player'),
  ('u_eli',   'Eli',    'player'),
  ('u_farah', 'Farah',  'player'),
  ('u_gus',   'Gus',    'player'),
  ('u_hana',  'Hana',   'player'),
  ('org_cardboard', 'Cardboard Castle Games', 'organizer'),
  ('org_metro',     'Metro Meetup Crew',      'organizer'),
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
INSERT INTO events (id, organizer_id, title, game_type, starts_at, location, capacity, rsvp_count, room_key,
                    place_id, place_address, place_lat, place_lng, place_resolved_at) VALUES
  -- No verified place: a fictional shop, exactly as an organizer would type it.
  ('evt_friday_draft', 'org_cardboard', 'Friday Night Draft', 'magic_draft',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','+2 days','start of day','+19 hours'),
   'Cardboard Castle, 114 Pike St', 8, 0, lower(hex(randomblob(8))),
   NULL, NULL, NULL, NULL, NULL),

  -- No verified place.
  ('evt_commander_pod', 'org_cardboard', 'Commander Pod Night', 'commander',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','+3 days','start of day','+18 hours'),
   'Cardboard Castle, 114 Pike St', 4, 0, lower(hex(randomblob(8))),
   NULL, NULL, NULL, NULL, NULL),

  -- Seattle Central Library (real public library). The label keeps the room
  -- number the organizer cares about; the address is Google's canonical form.
  ('evt_dnd_sunken_vault', 'org_metro', 'D&D One-Shot: The Sunken Vault', 'dnd',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','+4 days','start of day','+18 hours'),
   'Central Library, Room 2B', 5, 0, lower(hex(randomblob(8))),
   'seed_place_spl_central', '1000 4th Ave, Seattle, WA 98104, USA', 47.6067, -122.3325,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- Seattle Public Library, Ballard Branch (real public library).
  ('evt_board_game_meetup', 'org_metro', 'Board Game Meetup', 'board_games',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','+6 days','start of day','+17 hours'),
   'Ballard Library, meeting room', 12, 0, lower(hex(randomblob(8))),
   'seed_place_spl_ballard', '5614 22nd Ave NW, Seattle, WA 98107, USA', 47.6686, -122.3856,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- Green Lake Community Center (real city community centre).
  ('evt_warhammer_open', 'org_metro', 'Warhammer 40k Open Play', 'warhammer',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','+9 days','start of day','+13 hours'),
   'Green Lake Community Center, main hall', 6, 0, lower(hex(randomblob(8))),
   'seed_place_greenlake_cc', '7201 E Green Lake Dr N, Seattle, WA 98115, USA', 47.6807, -122.3283,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- Warren G. Magnuson Park (real city park). Proves the search join: nothing in
  -- the typed label says "Sand Point", but ?q=Sand Point finds this event.
  ('evt_learn_magic', 'org_cardboard', 'Learn to Play Magic', 'other',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','+14 days','start of day','+11 hours'),
   'Magnuson Park, Building 30', 10, 0, lower(hex(randomblob(8))),
   'seed_place_magnuson_park', '7400 Sand Point Way NE, Seattle, WA 98115, USA', 47.6806, -122.2570,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- Past event: must never appear in the upcoming list, and RSVPs to it 409.
  -- No verified place.
  ('evt_last_week_draft', 'org_cardboard', 'Last Week''s Draft', 'magic_draft',
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 days','start of day','+19 hours'),
   'Cardboard Castle, 114 Pike St', 8, 0, lower(hex(randomblob(8))),
   NULL, NULL, NULL, NULL, NULL);

-- ---------------------------------------------------------------- rsvps ----
-- created_at is staggered so the attendee list has a stable, meaningful order.

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

-- Single source of truth for the projection: derive it, never hand-count it.
UPDATE events SET rsvp_count = (SELECT COUNT(*) FROM rsvps WHERE rsvps.event_id = events.id);
