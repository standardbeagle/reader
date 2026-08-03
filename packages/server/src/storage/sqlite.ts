import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Storage, User, Feed, Article, ArticleWithState, ArticleQuery, FetchState,
  NormalizedItem, Ingestor, IngestorPatch,
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
    d.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`);
    const dir = join(import.meta.dirname, "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort((a, b) => {
      const na = parseInt(a, 10);
      const nb = parseInt(b, 10);
      if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    const applied = d.prepare("SELECT name FROM schema_migrations");
    const record = d.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)");
    const done = new Set((applied.all() as { name: string }[]).map((r) => r.name));
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = readFileSync(join(dir, file), "utf8");
      d.transaction(() => {
        d.exec(sql);
        record.run(file, new Date().toISOString());
      })();
    }
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

  function rowToIngestor(r: Record<string, unknown>): Ingestor {
    return {
      id: r.id as string, userId: r.user_id as string,
      kind: r.kind as Ingestor["kind"],
      config: JSON.parse(r.config as string) as Record<string, unknown>,
      feedId: r.feed_id as string,
      fetchIntervalMin: r.fetch_interval_min as number,
      digestMode: r.digest_mode as Ingestor["digestMode"],
      filterThreshold: r.filter_threshold as number,
      llmEnabled: (r.llm_enabled as number) === 1,
      status: r.status as "ok" | "broken",
      errorCount: r.error_count as number,
      lastFetchedAt: (r.last_fetched_at as string) ?? null,
      lastDeliveredAt: (r.last_delivered_at as string) ?? null,
      cursor: r.cursor ? JSON.parse(r.cursor as string) as Record<string, unknown> : null,
      createdAt: r.created_at as string,
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
      const feedRow = findUser.get(feedId) as { user_id: string } | undefined;
      if (!feedRow) throw new Error("feed not found: " + feedId);
      const userId = feedRow.user_id;
      const inserted: Article[] = [];
      const tx = db.transaction(() => {
        for (const a of articles) {
          const id = randomUUID();
          const now = new Date().toISOString();
          const contentHtml = a.contentHtml ? sanitize(a.contentHtml) : null;
          const res = insert.run(
            id, feedId, a.guid, a.url, a.title, a.author,
            a.publishedAt ? a.publishedAt.toISOString() : null,
            contentHtml,
            a.summary, now,
          );
          if (res.changes > 0) {
            insertUserArticleIfNew.run(userId, id, userId, id);
            inserted.push({
              id, feedId, guid: a.guid, url: a.url, title: a.title, author: a.author,
              publishedAt: a.publishedAt ? a.publishedAt.toISOString() : null,
              contentHtml, summary: a.summary, fetchedAt: now,
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
      if (q.before) { clauses.push("a.published_at < ?"); params.push(q.before); }
      params.push(q.limit);
      const rows = db.prepare(`
        SELECT a.*, ua.read_at
        FROM articles a
        JOIN feeds f ON f.id = a.feed_id
        LEFT JOIN user_articles ua ON ua.article_id = a.id AND ua.user_id = ?
        WHERE ${clauses.join(" AND ")}
        ORDER BY a.published_at IS NULL, a.published_at DESC, a.fetched_at DESC, a.id
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

    createIngestor(userId, input): Ingestor {
      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO ingestors (id, user_id, kind, config, feed_id, created_at)
                  VALUES (?, ?, ?, ?, ?, ?)`)
        .run(id, userId, input.kind, JSON.stringify(input.config), input.feedId, now);
      return this.getIngestor(id)!;
    },

    listIngestors(userId): Ingestor[] {
      const rows = db.prepare("SELECT * FROM ingestors WHERE user_id = ? ORDER BY created_at").all(userId) as Record<string, unknown>[];
      return rows.map(rowToIngestor);
    },

    getIngestor(id): Ingestor | null {
      const r = db.prepare("SELECT * FROM ingestors WHERE id = ?").get(id) as Record<string, unknown> | undefined;
      return r ? rowToIngestor(r) : null;
    },

    updateIngestor(id, patch: IngestorPatch): Ingestor {
      db.prepare(`
        UPDATE ingestors SET
          fetch_interval_min = COALESCE(?, fetch_interval_min),
          digest_mode = COALESCE(?, digest_mode),
          filter_threshold = COALESCE(?, filter_threshold),
          llm_enabled = COALESCE(?, llm_enabled)
        WHERE id = ?
      `).run(
        patch.fetchIntervalMin ?? null, patch.digestMode ?? null,
        patch.filterThreshold ?? null,
        patch.llmEnabled === undefined ? null : patch.llmEnabled ? 1 : 0,
        id,
      );
      const updated = this.getIngestor(id);
      if (!updated) throw new Error("ingestor not found: " + id);
      return updated;
    },

    deleteIngestor(id) {
      db.prepare("DELETE FROM ingestors WHERE id = ?").run(id);
    },

    dueIngestors(now): Ingestor[] {
      const rows = db.prepare(`
        SELECT * FROM ingestors
        WHERE status = 'ok'
          AND (last_fetched_at IS NULL
               OR julianday(last_fetched_at) <= julianday(?) - fetch_interval_min / 1440.0)
      `).all(now.toISOString()) as Record<string, unknown>[];
      return rows.map(rowToIngestor);
    },

    dueDigestFlushes(now): Ingestor[] {
      const rows = db.prepare(`
        SELECT i.* FROM ingestors i
        WHERE i.status = 'ok' AND i.digest_mode != 'realtime'
          AND EXISTS (SELECT 1 FROM ingestor_items s WHERE s.ingestor_id = i.id AND s.delivered_at IS NULL)
          AND (i.last_delivered_at IS NULL
               OR julianday(i.last_delivered_at) <= julianday(?) - (CASE i.digest_mode WHEN 'hourly' THEN 1.0/24 ELSE 1.0 END))
      `).all(now.toISOString()) as Record<string, unknown>[];
      return rows.map(rowToIngestor);
    },

    updateIngestorState(id, state) {
      db.prepare(`
        UPDATE ingestors SET
          last_fetched_at = COALESCE(?, last_fetched_at),
          last_delivered_at = COALESCE(?, last_delivered_at),
          cursor = COALESCE(?, cursor),
          error_count = ?,
          status = ?
        WHERE id = ?
      `).run(
        state.lastFetchedAt ?? null, state.lastDeliveredAt ?? null,
        state.cursor === undefined ? null : JSON.stringify(state.cursor),
        state.errorCount, state.status, id,
      );
    },

    stageItems(ingestorId, items: NormalizedItem[]): NormalizedItem[] {
      const insert = db.prepare(`
        INSERT INTO ingestor_items (id, ingestor_id, external_id, payload, fetched_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (ingestor_id, external_id) DO NOTHING
      `);
      const inserted: NormalizedItem[] = [];
      const tx = db.transaction(() => {
        for (const item of items) {
          const res = insert.run(
            randomUUID(), ingestorId, item.externalId,
            JSON.stringify(item), new Date().toISOString(),
          );
          if (res.changes > 0) inserted.push(item);
        }
      });
      tx();
      return inserted;
    },

    pendingItems(ingestorId): NormalizedItem[] {
      const rows = db.prepare(`
        SELECT payload FROM ingestor_items
        WHERE ingestor_id = ? AND delivered_at IS NULL
        ORDER BY fetched_at, id
      `).all(ingestorId) as { payload: string }[];
      return rows.map((r) => JSON.parse(r.payload) as NormalizedItem);
    },

    markDelivered(ingestorId, externalIds) {
      if (externalIds.length === 0) return;
      const placeholders = externalIds.map(() => "?").join(", ");
      db.prepare(`
        UPDATE ingestor_items SET delivered_at = ?
        WHERE ingestor_id = ? AND external_id IN (${placeholders})
      `).run(new Date().toISOString(), ingestorId, ...externalIds);
    },
  };
}
