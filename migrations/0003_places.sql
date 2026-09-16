-- Game Night — verified venues.
--
-- `location` does not change. It stays the required, human-readable label the
-- organizer types ("Cardboard Castle, back room") — and it is also the only
-- place a venue NAME can come from, because `displayName` is a Pro-tier field
-- on Google's Place Details SKU while `formattedAddress` and `location` are
-- Essentials. Asking for the name would triple the price of every lookup and
-- halve the free tier, to obtain a string the organizer already typed.
--
-- Everything below is the optional machine-readable half. Every column is
-- nullable, for two reasons: D1 cannot add a NOT NULL column without a constant
-- default to a table that already has rows, and — more importantly — "no
-- verified place" is a first-class state. A house game, a rented back room, a
-- church hall: none are in anyone's index, and all must stay postable.
ALTER TABLE events ADD COLUMN place_id TEXT;           -- Google place id, server-resolved, never client-supplied
ALTER TABLE events ADD COLUMN place_address TEXT;      -- canonical formattedAddress; uncapped, it is Google's string
ALTER TABLE events ADD COLUMN place_lat REAL;          -- WGS84
ALTER TABLE events ADD COLUMN place_lng REAL;
ALTER TABLE events ADD COLUMN place_resolved_at TEXT;  -- ISO-8601 UTC 'Z'; place ids and addresses do drift

-- No index on place_id: nothing looks an event up by venue today. Add one if
-- "other events at this venue" ever ships.

-- A hard ceiling on third-party spend that lives in the database rather than in
-- an isolate that scales to zero. One row per (UTC day, SKU); the Worker
-- increments it before every upstream call and refuses past the cap, so a hot
-- loop cannot bill us even if a rate limiter is bypassed. The per-SKU quota caps
-- in Google's console are the belt; this is the braces, and unlike the console
-- it is visible to anyone reading the repo.
CREATE TABLE api_usage (
  day   TEXT NOT NULL,                   -- 'YYYY-MM-DD' UTC
  sku   TEXT NOT NULL,                   -- 'autocomplete' | 'place_details' | 'static_map'
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, sku)
);
