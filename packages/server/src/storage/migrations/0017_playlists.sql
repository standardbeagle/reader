-- A list is permanent: it keeps what is saved to it. A playlist is a named
-- play queue: it remembers what is playing and how far in, and an article
-- that has been played drops off.
ALTER TABLE lists ADD COLUMN kind TEXT NOT NULL DEFAULT 'list' CHECK (kind IN ('list', 'playlist'));
ALTER TABLE lists ADD COLUMN playing_article_id TEXT REFERENCES articles(id) ON DELETE SET NULL;
ALTER TABLE lists ADD COLUMN playing_seconds REAL NOT NULL DEFAULT 0;

-- Played is the user's state for an article, like read: playing it once, from
-- anywhere, takes it off every playlist. A manual playlist loses the row; a
-- dynamic playlist's rule skips what has played_at set.
ALTER TABLE user_articles ADD COLUMN played_at TEXT;
