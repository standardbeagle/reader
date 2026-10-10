-- Per-user switches. Libby's account sync goes through a private, undocumented
-- API, so it stays off until the user turns it on.
ALTER TABLE users ADD COLUMN libby_sync_enabled INTEGER NOT NULL DEFAULT 0;
