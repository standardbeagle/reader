-- Snoozed articles stay unread but hidden until snoozed_until passes.
ALTER TABLE user_articles ADD COLUMN snoozed_until TEXT;

-- Saved lists: permanent collections of articles. A public list is readable
-- by anyone holding its unguessable token, served as an RSS feed.
CREATE TABLE lists (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE list_items (
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL,
  PRIMARY KEY (list_id, article_id)
);

CREATE INDEX idx_list_items_article ON list_items(article_id);
