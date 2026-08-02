import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Storage, User, Feed, Article, ArticleWithState, ArticleQuery, FetchState,
} from "./types.js";
import type { ParsedArticle } from "@reader/core";

const LOCAL_USER_EMAIL = "local@reader";

export function createSqliteStorage(path: string): Storage {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);

  const insertUserArticleIfNew = db.prepare(`
    INSERT INTO user_articles (user_id, article_id, read_at, starred_at)
    SELECT ?, ?, NULL, NULL
    WHERE NOT EXISTS (
      SELECT 1 FROM user_articles WHERE user_id = ? AND article_id = ?
    )
  `);

  function migrate(d: Database.Database) {
    const dir = join(import.meta.dirname, "migrations");
    d.exec(readFileSync(join(dir, "0001_init.sql"), "utf8"));
  }

  function rowToFeed(r: Record<string, unknown>): Feed {
    return {
      id: r.id as string, userId: r.user_id as string, url: r.url as string,
      title: r.title as string, siteUrl: (r.site_url as string) ?? null,
      etag: (r.etag as string) ?? null,
      lastModified: (r.last_modified as string) ?? null,
      lastFetchedAt: (r.last_fetched_at as string) ?? null,
      fetchIntervalMin: r.fetch_interval_min as number,
      errorCount: r.error_count as number,
      status: r.status as "ok" | "broken",
      createdAt: r.created_at as string,
    };
  }

  function rowToArticle(r: Record<string, unknown>): Article {
    return {
      id: r.id as string, feedId: r.feed_id as string, guid: r.guid as string,
      url: (r.url as string) ?? null, title: r.title as string,
      author: (r.author as string) ?? null,
      publishedAt: (r.published_at as string) ?? null,
      contentHtml: (r.content_html as string) ?? null,
      summary: (r.summary as string) ?? null,
      fetchedAt: r.fetched_at as string,
    };
  }

  return {
    close() { db.close(); },

    getOrCreateLocalUser(): User {
      const existing = db.prepare("SELECT * FROM users WHERE email = ?").get(LOCAL_USER_EMAIL) as Record<string, unknown> | undefined;
      if (existing) return { id: existing.id as string, email: existing.email as string, createdAt: existing.created_at as string };
      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, NULL, ?)").run(id, LOCAL_USER_EMAIL, now);
      return { id, email: LOCAL_USER_EMAIL, createdAt: now };
    },

    createFeed(userId, input): Feed {
      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO feeds (id, user_id, url, title, site_url, created_at)
                  VALUES (?, ?, ?, ?, ?, ?)`).run(id, userId, input.url, input.title, input.siteUrl, now);
      return this.getFeed(id)!;
    },

    listFeeds(userId): Feed[] {
      const rows = db.prepare("SELECT * FROM feeds WHERE user_id = ? ORDER BY title").all(userId) as Record<string, unknown>[];
      return rows.map(rowToFeed);
    },

    getFeed(id): Feed | null {
      const r = db.prepare("SELECT * FROM feeds WHERE id = ?").get(id) as Record<string, unknown> | undefined;
      return r ? rowToFeed(r) : null;
    },

    deleteFeed(id) { db.prepare("DELETE FROM feeds WHERE id = ?").run(id); },

    dueFeeds(now): Feed[] {
      // julianday handles ISO strings with 'T'/'Z'; string comparison against
      // datetime() output (space separator) would misorder.
      const rows = db.prepare(`
        SELECT * FROM feeds
        WHERE status = 'ok'
          AND (last_fetched_at IS NULL
               OR julianday(last_fetched_at) <= julianday(?) - fetch_interval_min / 1440.0)
      `).all(now.toISOString()) as Record<string, unknown>[];
      return rows.map(rowToFeed);
    },

    updateFeedFetchState(id, state: FetchState) {
      db.prepare(`
        UPDATE feeds SET
          etag = COALESCE(?, etag),
          last_modified = COALESCE(?, last_modified),
          last_fetched_at = ?,
          fetch_interval_min = ?,
          error_count = ?,
          status = ?,
          title = COALESCE(?, title),
          site_url = COALESCE(?, site_url)
        WHERE id = ?
      `).run(
        state.etag ?? null, state.lastModified ?? null, state.lastFetchedAt,
        state.fetchIntervalMin, state.errorCount, state.status,
        state.title ?? null, state.siteUrl ?? null, id,
      );
    },

    upsertArticles(feedId, articles: ParsedArticle[], sanitize): Article[] {
      const insert = db.prepare(`
        INSERT INTO articles (id, feed_id, guid, url, title, author, published_at, content_html, summary, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (feed_id, guid) DO NOTHING
      `);
      const findUser = db.prepare("SELECT user_id FROM feeds WHERE id = ?");
      const userId = (findUser.get(feedId) as { user_id: string }).user_id;
      const inserted: Article[] = [];
      const tx = db.transaction(() => {
        for (const a of articles) {
          const id = randomUUID();
          const now = new Date().toISOString();
          const res = insert.run(
            id, feedId, a.guid, a.url, a.title, a.author,
            a.publishedAt ? a.publishedAt.toISOString() : null,
            a.contentHtml ? sanitize(a.contentHtml) : null,
            a.summary, now,
          );
          if (res.changes > 0) {
            insertUserArticleIfNew.run(userId, id, userId, id);
            inserted.push({
              id, feedId, guid: a.guid, url: a.url, title: a.title, author: a.author,
              publishedAt: a.publishedAt ? a.publishedAt.toISOString() : null,
              contentHtml: a.contentHtml, summary: a.summary, fetchedAt: now,
            });
          }
        }
      });
      tx();
      return inserted;
    },

    listArticles(q: ArticleQuery): ArticleWithState[] {
      const clauses = ["f.user_id = ?"];
      const params: unknown[] = [q.userId];
      if (q.feedId) { clauses.push("a.feed_id = ?"); params.push(q.feedId); }
      if (q.unreadOnly) { clauses.push("ua.read_at IS NULL"); }
      if (q.before) { clauses.push("(a.published_at IS NULL OR a.published_at < ?)"); params.push(q.before); }
      params.push(q.limit);
      const rows = db.prepare(`
        SELECT a.*, ua.read_at
        FROM articles a
        JOIN feeds f ON f.id = a.feed_id
        LEFT JOIN user_articles ua ON ua.article_id = a.id AND ua.user_id = ?
        WHERE ${clauses.join(" AND ")}
        ORDER BY a.published_at IS NULL, a.published_at DESC, a.fetched_at DESC
        LIMIT ?
      `).all(q.userId, ...params) as Record<string, unknown>[];
      return rows.map((r) => ({ ...rowToArticle(r), readAt: (r.read_at as string) ?? null }));
    },

    setRead(userId, articleId, read) {
      db.prepare(`
        INSERT INTO user_articles (user_id, article_id, read_at, starred_at)
        VALUES (?, ?, ?, NULL)
        ON CONFLICT (user_id, article_id) DO UPDATE SET read_at = excluded.read_at
      `).run(userId, articleId, read ? new Date().toISOString() : null);
    },

    markAllRead(userId, feedId) {
      db.prepare(`
        INSERT INTO user_articles (user_id, article_id, read_at, starred_at)
        SELECT ?, id, ?, NULL FROM articles WHERE feed_id = ?
        ON CONFLICT (user_id, article_id) DO UPDATE SET read_at = excluded.read_at
      `).run(userId, new Date().toISOString(), feedId);
    },

    unreadCounts(userId): Record<string, number> {
      const rows = db.prepare(`
        SELECT a.feed_id, COUNT(*) AS n
        FROM articles a
        JOIN feeds f ON f.id = a.feed_id
        LEFT JOIN user_articles ua ON ua.article_id = a.id AND ua.user_id = ?
        WHERE f.user_id = ? AND ua.read_at IS NULL
        GROUP BY a.feed_id
      `).all(userId, userId) as { feed_id: string; n: number }[];
      return Object.fromEntries(rows.map((r) => [r.feed_id, r.n]));
    },
  };
}
