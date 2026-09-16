-- Game Night — the admin surface.
--
-- Three things arrive here: the `admin` role plus suspension on `users`,
-- cancellation as a status on `events`, and the two operator-facing tables
-- (`error_log`, `audit_log`).
--
-- Timestamps stay ISO-8601 UTC strings ending in 'Z', as in 0001.

-- ---------------------------------------------------------------- users ----
-- `role` gains 'admin' and suspension is one nullable timestamp (a suspended
-- account is refused at the auth resolver, so no route has to remember).
--
-- SQLite cannot ALTER a CHECK constraint, so the table is rebuilt. That is
-- harder than it looks: events/rsvps reference users(id) with foreign keys ON,
-- and D1 does not allow `PRAGMA foreign_keys = OFF`. `PRAGMA defer_foreign_keys`
-- does not help either — `DROP TABLE users` counts one deferred violation per
-- child row, and renaming the new table into place never counts them back
-- down, so the transaction still fails at COMMIT (it did, on production; D1
-- rolled back). Miniflare accepts it, which is exactly the kind of local/prod
-- gap this comment exists to remember.
--
-- So: park the child rows, empty the children, swap the parent, restore the
-- children. Every statement is FK-consistent on its own. The copies have no
-- constraints (CREATE TABLE … AS), and the events columns are added AFTER the
-- restore so `INSERT … SELECT *` lines up. Fine at this scale; at the
-- 12-month scale this is a maintenance-window migration, not a deploy-time one.
CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('player','organizer','admin')),
  suspended_at TEXT,                       -- NULL = active; set = refused at auth
  suspended_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

INSERT INTO users_new (id, name, role, created_at)
  SELECT id, name, role, created_at FROM users;

CREATE TABLE _rsvps_park AS SELECT * FROM rsvps;
CREATE TABLE _events_park AS SELECT * FROM events;
DELETE FROM rsvps;
DELETE FROM events;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

INSERT INTO events SELECT * FROM _events_park;
INSERT INTO rsvps SELECT * FROM _rsvps_park;
DROP TABLE _events_park;
DROP TABLE _rsvps_park;

-- Admin "users" list: filter by role, newest first.
CREATE INDEX idx_users_role ON users(role, created_at);

-- --------------------------------------------------------------- events ----
-- Cancellation is a status, not a delete: the RSVP rows and the audit trail
-- have to survive it, and a player needs to be told their event was called off.
ALTER TABLE events ADD COLUMN status TEXT NOT NULL DEFAULT 'scheduled'
  CHECK (status IN ('scheduled','cancelled'));
ALTER TABLE events ADD COLUMN cancelled_at TEXT;

-- ------------------------------------------------------------ error_log ----
-- Backend failures, deduplicated by fingerprint (scope + normalised message)
-- and counted, so a hot loop is one row with count = 4,912 rather than 4,912
-- rows. Written best-effort after console.error — see `worker/lib/report.ts`.
CREATE TABLE error_log (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,        -- the upsert key
  scope TEXT NOT NULL,                     -- e.g. "http.PUT /api/events/:id/rsvp"
  message TEXT NOT NULL,
  stack TEXT,
  metadata TEXT,                           -- JSON
  count INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  resolved_at TEXT                         -- cleared again if the error recurs
);

CREATE INDEX idx_error_log_last_seen ON error_log(last_seen_at);

-- ------------------------------------------------------------ audit_log ----
-- Who did what. The actor is always the admin; the subject goes in target_*.
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,                    -- the `AuditAction` union
  target_type TEXT NOT NULL,               -- 'user' | 'event' | 'error'
  target_id TEXT NOT NULL,
  metadata TEXT,                           -- JSON
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX idx_audit_created ON audit_log(created_at);
