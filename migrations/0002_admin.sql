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
-- SQLite cannot ALTER a CHECK constraint, so the table is rebuilt. D1 runs a
-- migration file as one transaction with foreign keys ON, and events/rsvps
-- reference users(id) — dropping the old table would trip those references
-- mid-transaction, so the check is deferred to COMMIT, by which time
-- `users_new` has been renamed into place with every id intact.
PRAGMA defer_foreign_keys = true;

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

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

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
