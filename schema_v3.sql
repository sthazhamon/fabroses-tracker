-- FabRoses tracking system — Schema migration v3 (proper login & access control)
-- Run AFTER schema.sql and schema_v2.sql, with:
-- wrangler d1 execute fabroses-db --file=./schema_v3.sql --remote
--
-- NOTE: this rebuilds the `users` table from scratch rather than patching it
-- with ALTER TABLE, because the original table had `pin TEXT NOT NULL UNIQUE`
-- and SQLite won't let you drop a UNIQUE-constrained column with a simple
-- ALTER TABLE DROP COLUMN. Since the only login this table ever held was the
-- insecure seed PIN (1234) — which this migration is specifically retiring —
-- there's nothing worth preserving, so a clean rebuild is simplest and safest.
-- This is safe to re-run if it failed partway before.

DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT UNIQUE,
  pin_hash TEXT,
  pin_salt TEXT,
  role TEXT NOT NULL,
  reseller_name TEXT,
  token_version INTEGER DEFAULT 1,
  failed_attempts INTEGER DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- You now have zero logins. Use scripts/create-admin.js to bootstrap the first
-- one (see README) — the app has no way to create a login before the first
-- admin exists.
