CREATE TABLE ingestors (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('mastodon', 'bluesky', 'reddit')),
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

CREATE TABLE ingestor_items (
  id TEXT PRIMARY KEY,
  ingestor_id TEXT NOT NULL REFERENCES ingestors(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  delivered_at TEXT,
  UNIQUE (ingestor_id, external_id)
);

CREATE INDEX idx_ingestor_items_pending ON ingestor_items(ingestor_id, delivered_at);
