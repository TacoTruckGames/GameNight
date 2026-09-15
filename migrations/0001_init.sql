-- Game Night — initial schema.
-- Timestamps are ISO-8601 UTC strings ending in 'Z'; the client renders them in local time.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('player','organizer')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  organizer_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  game_type TEXT NOT NULL,
  starts_at TEXT NOT NULL,                 -- ISO-8601 UTC 'Z'
  location TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 500),
  -- Write-through projection of COUNT(*) over rsvps, recomputed in the same
  -- atomic D1 batch as every insert/delete, so it cannot drift. Read paths
  -- never COUNT(*).
  rsvp_count INTEGER NOT NULL DEFAULT 0 CHECK (rsvp_count >= 0 AND rsvp_count <= capacity),
  room_key TEXT NOT NULL,                  -- salts the Durable Object name; rotate = fresh room
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX idx_events_starts_at ON events(starts_at);
CREATE INDEX idx_events_organizer ON events(organizer_id, starts_at);

CREATE TABLE rsvps (
  event_id TEXT NOT NULL REFERENCES events(id),
  player_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (event_id, player_id)        -- S2: no duplicate RSVPs, at the DB level
);

CREATE INDEX idx_rsvps_player ON rsvps(player_id);
