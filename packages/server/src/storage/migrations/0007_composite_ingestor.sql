-- SQLite cannot alter a CHECK constraint; rebuild the table with 'composite'
-- added to the allowed kinds. The migration runner disables foreign keys while
-- applying files, so dropping the parent table is safe.
CREATE TABLE ingestors_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('mastodon', 'bluesky', 'reddit', 'composite')),
  config TEXT NOT NULL,
  feed_id TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  fetch_interval_min INTEGER NOT NULL DEFAULT 60,
  digest_mode TEXT NOT NULL DEFAULT 'realtime' CHECK (digest_mode IN ('realtime', 'hourly', 'daily')),
  filter_threshold INTEGER NOT NULL DEFAULT 5,
  llm_enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'ok',
  error_count INTEGER NOT NULL DEFAULT 0,
  last_fetched_at TEXT,
  last_delivered_at TEXT,
  cursor TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO ingestors_new
  SELECT id, user_id, kind, config, feed_id, fetch_interval_min, digest_mode,
         filter_threshold, llm_enabled, status, error_count, last_fetched_at,
         last_delivered_at, cursor, created_at
  FROM ingestors;

DROP TABLE ingestors;
ALTER TABLE ingestors_new RENAME TO ingestors;
