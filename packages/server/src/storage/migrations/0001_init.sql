CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  password_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE feeds (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  site_url TEXT,
  etag TEXT,
  last_modified TEXT,
  last_fetched_at TEXT,
  fetch_interval_min INTEGER NOT NULL DEFAULT 60,
  error_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok',
  created_at TEXT NOT NULL,
  UNIQUE (user_id, url)
);

CREATE TABLE articles (
  id TEXT PRIMARY KEY,
  feed_id TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  guid TEXT NOT NULL,
  url TEXT,
  title TEXT NOT NULL,
  author TEXT,
  published_at TEXT,
  content_html TEXT,
  summary TEXT,
  fetched_at TEXT NOT NULL,
  UNIQUE (feed_id, guid)
);

CREATE TABLE user_articles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  read_at TEXT,
  starred_at TEXT,
  PRIMARY KEY (user_id, article_id)
);

CREATE INDEX idx_articles_feed_published ON articles(feed_id, published_at DESC);
CREATE INDEX idx_user_articles_read ON user_articles(user_id, read_at);
