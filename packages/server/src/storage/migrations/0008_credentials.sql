-- Credentials a feed or ingestor authenticates with. `secret` is JSON holding
-- the password, token or OAuth grant; it never leaves the server. `origin` is
-- the only scheme://host:port the credential may be sent to.
CREATE TABLE credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('generic', 'mastodon', 'reddit')),
  label TEXT NOT NULL,
  origin TEXT NOT NULL,
  secret TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- No ON DELETE action: deleting a credential a feed still uses is refused.
ALTER TABLE feeds ADD COLUMN credential_id TEXT REFERENCES credentials(id);
