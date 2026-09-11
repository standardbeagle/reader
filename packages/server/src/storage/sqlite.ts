import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Storage, User, Feed, Article, ArticleWithState, ArticleQuery, FetchState,
  NormalizedItem, Ingestor, IngestorPatch, CategoryCount, SavedList, SavedListWithCount,
  Credential, CredentialSecret,
} from "./types.js";
import { decodeHtmlEntities, looksLikeHtml, plainTextToHtml, sanitizeHtml, type ParsedArticle } from "@reader/core";

const LOCAL_USER_EMAIL = "local@reader";

function resolveHttpUrl(raw: string, baseUrl?: string): string | null {
  try {
    const url = new URL(raw, baseUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** First http(s) image in sanitized content, as a hero fallback for pinboard cards. */
function heroFromContent(html: string | null, baseUrl?: string): string | null {
  if (!html) return null;
  const match = /<img\s[^>]*?src\s*=\s*["']([^"']+)["']/i.exec(html);
  return match ? resolveHttpUrl(match[1]!, baseUrl) : null;
}

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
    // Table-rebuild migrations drop referenced parent tables; PRAGMA foreign_keys
    // cannot be changed inside the per-file transaction, so scope it here.
    d.pragma("foreign_keys = OFF");
    try {
      for (const file of files) {
        if (done.has(file)) continue;
        const sql = readFileSync(join(dir, file), "utf8");
        d.transaction(() => {
          d.exec(sql);
          record.run(file, new Date().toISOString());
        })();
      }
    } finally {
      d.pragma("foreign_keys = ON");
    }
  }

  function rowToFeed(r: Record<string, unknown>): Feed {
    return {
      id: r.id as string, userId: r.user_id as string, url: r.url as string,
      title: r.title as string, siteUrl: (r.site_url as string) ?? null,
      etag: (r.etag as string) ?? null,
      lastModified: (r.last_modified as string) ?? null,
      lastFetchedAt: (r.last_fetched_at as string) ?? null,
      lastError: (r.last_error as string) ?? null,
      fetchIntervalMin: r.fetch_interval_min as number,
      errorCount: r.error_count as number,
      status: r.status as "ok" | "broken",
      credentialId: (r.credential_id as string) ?? null,
      retryAfter: (r.retry_after as string) ?? null,
      createdAt: r.created_at as string,
    };
  }

  function rowToCredential(r: Record<string, unknown>): Credential {
    return {
      id: r.id as string, userId: r.user_id as string,
      provider: r.provider as Credential["provider"],
      label: r.label as string,
      origin: r.origin as string,
      secret: JSON.parse(r.secret as string) as CredentialSecret,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    };
  }

  function categoriesFromJson(raw: unknown): string[] {
    if (typeof raw !== "string" || !raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
    } catch {
      return [];
    }
  }

  function rowToArticle(r: Record<string, unknown>, includeContent = true): Article {
    const rawContent = includeContent ? (r.content_html as string) ?? null : null;
    const rawSummary = includeContent ? (r.summary as string) ?? null : null;
    const baseUrl = includeContent
      ? (r.url as string) ?? (r.feed_site_url as string) ?? (r.feed_url as string) ?? undefined
      : undefined;
    const promotedSummary = !rawContent && looksLikeHtml(rawSummary) ? sanitizeHtml(rawSummary!, baseUrl) : null;
    const contentHtml = rawContent
      ? sanitizeHtml(looksLikeHtml(rawContent) ? rawContent : plainTextToHtml(rawContent), baseUrl)
      : promotedSummary;
    return {
      id: r.id as string, feedId: r.feed_id as string, guid: r.guid as string,
      // The parser decodes entities in titles now; rows stored before that
      // (and gone from their feed, so never rewritten) are decoded here.
      url: (r.url as string) ?? null, title: decodeHtmlEntities(r.title as string),
      author: (r.author as string) ?? null,
      publishedAt: (r.published_at as string) ?? null,
      contentHtml,
      summary: promotedSummary ? null : rawSummary,
      imageUrl: includeContent ? (r.image_url as string) ?? null : null,
      categories: categoriesFromJson(r.categories),
      media: r.media_url ? { url: r.media_url as string, type: (r.media_type as string) ?? null } : null,
      transcript: includeContent && r.transcript_url ? { url: r.transcript_url as string, type: (r.transcript_type as string) ?? null } : null,
      chaptersUrl: includeContent ? (r.chapters_url as string) ?? null : null,
      fetchedAt: r.fetched_at as string,
    };
  }

  function rowToList(r: Record<string, unknown>): SavedList {
    return {
      id: r.id as string, userId: r.user_id as string,
      title: r.title as string,
      visibility: r.visibility as SavedList["visibility"],
      token: r.token as string,
      createdAt: r.created_at as string,
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
      db.prepare(`INSERT INTO feeds (id, user_id, url, title, site_url, credential_id, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, userId, input.url, input.title, input.siteUrl, input.credentialId ?? null, now);
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
        WHERE url NOT LIKE 'ingestor://%' AND (
          (
            status = 'ok'
            AND (last_fetched_at IS NULL
                 OR julianday(last_fetched_at) <= julianday(?) - fetch_interval_min / 1440.0)
          ) OR (
            status = 'broken'
            AND (last_fetched_at IS NULL
                 OR julianday(last_fetched_at) <= julianday(?) - MIN(fetch_interval_min, 60) / 1440.0)
          )
        )
      `).all(now.toISOString(), now.toISOString()) as Record<string, unknown>[];
      return rows.map(rowToFeed);
    },

    podcastFeeds() {
      return db.prepare(`
        SELECT f.id, f.url FROM feeds f
        WHERE f.url NOT LIKE 'ingestor://%'
          AND EXISTS (SELECT 1 FROM articles a WHERE a.feed_id = f.id AND a.media_url IS NOT NULL)
      `).all() as { id: string; url: string }[];
    },

    updateFeedFetchState(id, state: FetchState) {
      db.prepare(`
        UPDATE feeds SET
          etag = COALESCE(?, etag),
          last_modified = COALESCE(?, last_modified),
          last_fetched_at = ?,
          last_error = ?,
          fetch_interval_min = ?,
          error_count = ?,
          status = ?,
          title = COALESCE(?, title),
          site_url = COALESCE(?, site_url),
          retry_after = ?
        WHERE id = ?
      `).run(
        state.etag ?? null, state.lastModified ?? null, state.lastFetchedAt,
        state.lastError ?? null,
        state.fetchIntervalMin, state.errorCount, state.status,
        state.title ?? null, state.siteUrl ?? null, state.retryAfter ?? null, id,
      );
    },

    upsertArticles(feedId, articles: ParsedArticle[], sanitize, baseUrl): Article[] {
      const insert = db.prepare(`
        INSERT INTO articles (id, feed_id, guid, url, title, author, published_at, content_html, summary, image_url, categories,
                              media_url, media_type, transcript_url, transcript_type, chapters_url, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (feed_id, guid) DO NOTHING
      `);
      const updateExisting = db.prepare(`
        UPDATE articles SET
          url = ?, title = ?, author = ?, published_at = ?,
          content_html = COALESCE(?, content_html),
          summary = CASE WHEN ? IS NOT NULL THEN ? ELSE summary END,
          image_url = COALESCE(?, image_url),
          categories = ?,
          media_url = COALESCE(?, media_url), media_type = COALESCE(?, media_type),
          transcript_url = COALESCE(?, transcript_url), transcript_type = COALESCE(?, transcript_type),
          chapters_url = COALESCE(?, chapters_url),
          fetched_at = ?
        WHERE feed_id = ? AND guid = ?
      `);
      const findUser = db.prepare("SELECT user_id, url, site_url FROM feeds WHERE id = ?");
      const feedRow = findUser.get(feedId) as { user_id: string; url: string; site_url: string | null } | undefined;
      if (!feedRow) throw new Error("feed not found: " + feedId);
      const userId = feedRow.user_id;
      const resolvedBaseUrl = baseUrl ?? feedRow.site_url ?? feedRow.url;
      const inserted: Article[] = [];
      const tx = db.transaction(() => {
        for (const a of articles) {
          const id = randomUUID();
          const now = new Date().toISOString();
          const rawContent = a.contentHtml?.trim() || null;
          const rawSummary = a.summary?.trim() || null;
          const contentSource = rawContent ?? (looksLikeHtml(rawSummary) ? rawSummary : null);
          const contentHtml = contentSource
            ? sanitize(looksLikeHtml(contentSource) ? contentSource : plainTextToHtml(contentSource), a.url ?? resolvedBaseUrl)
            : null;
          const summary = rawContent ? rawSummary : contentSource ? null : rawSummary;
          const imageUrl = (a.imageUrl ? resolveHttpUrl(a.imageUrl, a.url ?? resolvedBaseUrl) : null)
            ?? heroFromContent(contentHtml, a.url ?? resolvedBaseUrl);
          const categories = (a.categories ?? []).slice(0, 8);
          const categoriesJson = JSON.stringify(categories);
          const linkBase = a.url ?? resolvedBaseUrl;
          const media = a.media ? { url: resolveHttpUrl(a.media.url, linkBase), type: a.media.type } : null;
          const transcript = a.transcript ? { url: resolveHttpUrl(a.transcript.url, linkBase), type: a.transcript.type } : null;
          const chaptersUrl = a.chaptersUrl ? resolveHttpUrl(a.chaptersUrl, linkBase) : null;
          const extras = [
            media?.url ?? null, media?.url ? media.type : null,
            transcript?.url ?? null, transcript?.url ? transcript.type : null,
            chaptersUrl,
          ];
          const res = insert.run(
            id, feedId, a.guid, a.url, a.title, a.author,
            a.publishedAt ? a.publishedAt.toISOString() : null,
            contentHtml,
            summary, imageUrl, categoriesJson, ...extras, now,
          );
          if (res.changes > 0) {
            insertUserArticleIfNew.run(userId, id, userId, id);
            inserted.push({
              id, feedId, guid: a.guid, url: a.url, title: a.title, author: a.author,
              publishedAt: a.publishedAt ? a.publishedAt.toISOString() : null,
              contentHtml, summary, imageUrl, categories, fetchedAt: now,
              media: media?.url ? { url: media.url, type: media.type } : null,
              transcript: transcript?.url ? { url: transcript.url, type: transcript.type } : null,
              chaptersUrl,
            });
          } else {
            updateExisting.run(
              a.url, a.title, a.author, a.publishedAt ? a.publishedAt.toISOString() : null,
              contentHtml, contentHtml, summary, imageUrl, categoriesJson, ...extras, now, feedId, a.guid,
            );
          }
        }
      });
      tx();
      return inserted;
    },

    listArticles(q: ArticleQuery): ArticleWithState[] {
      const includeContent = q.includeContent !== false;
      const clauses = ["f.user_id = ?"];
      const params: unknown[] = [q.userId];
      if (q.feedId) { clauses.push("a.feed_id = ?"); params.push(q.feedId); }
      if (q.listId) { clauses.push("li.list_id = ?"); params.push(q.listId); }
      if (q.unreadOnly) { clauses.push("ua.read_at IS NULL"); }
      if (!q.includeSnoozed) {
        clauses.push("(ua.snoozed_until IS NULL OR ua.snoozed_until <= ?)");
        params.push(new Date().toISOString());
      }
      if (q.category) {
        clauses.push("EXISTS (SELECT 1 FROM json_each(a.categories) je WHERE je.value = ?)");
        params.push(q.category);
      }
      // Keyset cursor over (published_at, id): the id half keeps articles that
      // share the boundary timestamp from being skipped between pages. The id
      // comparison follows the ORDER BY tiebreak (ascending within a
      // timestamp), so continuation means id > cursor id.
      if (q.before) {
        if (q.beforeId) {
          clauses.push("(a.published_at < ? OR (a.published_at = ? AND a.id > ?))");
          params.push(q.before, q.before, q.beforeId);
        } else {
          clauses.push("a.published_at < ?");
          params.push(q.before);
        }
      }
      params.push(q.limit);
      const articleColumns = includeContent
        ? "a.*"
        : `a.id, a.feed_id, a.guid, a.url, a.title, a.author, a.published_at,
           NULL AS content_html, NULL AS summary, a.image_url, a.media_url, a.media_type, a.fetched_at`;
      // Ordering must stay aligned with the keyset cursor below:
      // (published_at, id) both directions included, so no page boundary can
      // skip or repeat a row. fetched_at is deliberately not a tiebreak — it
      // changes on refresh and would corrupt the cursor position.
      const rows = db.prepare(`
        SELECT ${articleColumns}, ua.read_at, ua.snoozed_until
        FROM articles a
        JOIN feeds f ON f.id = a.feed_id
        ${q.listId ? "JOIN list_items li ON li.article_id = a.id" : ""}
        LEFT JOIN user_articles ua ON ua.article_id = a.id AND ua.user_id = ?
        WHERE ${clauses.join(" AND ")}
        ORDER BY a.published_at IS NULL, a.published_at DESC, a.id
        LIMIT ?
      `).all(q.userId, ...params) as Record<string, unknown>[];
      return rows.map((r) => ({
        ...rowToArticle(r, includeContent),
        readAt: (r.read_at as string) ?? null,
        snoozedUntil: (r.snoozed_until as string) ?? null,
      }));
    },

    listCategories(userId, feedId): CategoryCount[] {
      const clauses = ["f.user_id = ?"];
      const params: unknown[] = [userId];
      if (feedId) { clauses.push("a.feed_id = ?"); params.push(feedId); }
      const rows = db.prepare(`
        SELECT je.value AS name, COUNT(*) AS count
        FROM articles a
        JOIN feeds f ON f.id = a.feed_id
        JOIN json_each(a.categories) je
        WHERE ${clauses.join(" AND ")}
        GROUP BY je.value
        ORDER BY count DESC, name ASC
      `).all(...params) as Record<string, unknown>[];
      return rows.map((r) => ({ name: r.name as string, count: r.count as number }));
    },

    getArticle(userId, articleId): ArticleWithState | null {
      const row = db.prepare(`
        SELECT a.*, ua.read_at, ua.snoozed_until, f.site_url AS feed_site_url, f.url AS feed_url
        FROM articles a
        JOIN feeds f ON f.id = a.feed_id
        LEFT JOIN user_articles ua ON ua.article_id = a.id AND ua.user_id = ?
        WHERE a.id = ? AND f.user_id = ?
      `).get(userId, articleId, userId) as Record<string, unknown> | undefined;
      if (!row) return null;
      const listRows = db.prepare(`
        SELECT li.list_id FROM list_items li
        JOIN lists l ON l.id = li.list_id
        WHERE li.article_id = ? AND l.user_id = ?
      `).all(articleId, userId) as { list_id: string }[];
      return {
        ...rowToArticle(row),
        readAt: (row.read_at as string) ?? null,
        snoozedUntil: (row.snoozed_until as string) ?? null,
        listIds: listRows.map((r) => r.list_id),
      };
    },

    setRead(userId, articleId, read) {
      db.prepare(`
        INSERT INTO user_articles (user_id, article_id, read_at, starred_at)
        VALUES (?, ?, ?, NULL)
        ON CONFLICT (user_id, article_id) DO UPDATE SET read_at = excluded.read_at
      `).run(userId, articleId, read ? new Date().toISOString() : null);
    },

    setSnooze(userId, articleId, until) {
      // Setting a snooze also clears read_at: a snoozed article comes back
      // unread when the snooze expires. Clearing the snooze leaves read_at
      // alone, and marking read never clears the snooze.
      db.prepare(`
        INSERT INTO user_articles (user_id, article_id, read_at, starred_at, snoozed_until)
        VALUES (?, ?, NULL, NULL, ?)
        ON CONFLICT (user_id, article_id) DO UPDATE SET
          snoozed_until = excluded.snoozed_until,
          read_at = CASE WHEN excluded.snoozed_until IS NOT NULL THEN NULL ELSE read_at END
      `).run(userId, articleId, until ? until.toISOString() : null);
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
          AND (ua.snoozed_until IS NULL OR ua.snoozed_until <= ?)
        GROUP BY a.feed_id
      `).all(userId, userId, new Date().toISOString()) as { feed_id: string; n: number }[];
      return Object.fromEntries(rows.map((r) => [r.feed_id, r.n]));
    },

    createList(userId, input): SavedList {
      const id = randomUUID();
      const token = randomUUID();
      db.prepare(`INSERT INTO lists (id, user_id, title, visibility, token, created_at)
                  VALUES (?, ?, ?, ?, ?, ?)`)
        .run(id, userId, input.title, input.visibility, token, new Date().toISOString());
      return this.getList(id)!;
    },

    listLists(userId): SavedListWithCount[] {
      const rows = db.prepare(`
        SELECT l.*, COUNT(li.article_id) AS item_count
        FROM lists l
        LEFT JOIN list_items li ON li.list_id = l.id
        WHERE l.user_id = ?
        GROUP BY l.id
        ORDER BY l.created_at
      `).all(userId) as Record<string, unknown>[];
      return rows.map((r) => ({ ...rowToList(r), itemCount: r.item_count as number }));
    },

    getList(id): SavedList | null {
      const r = db.prepare("SELECT * FROM lists WHERE id = ?").get(id) as Record<string, unknown> | undefined;
      return r ? rowToList(r) : null;
    },

    getListByToken(token): SavedList | null {
      const r = db.prepare("SELECT * FROM lists WHERE token = ?").get(token) as Record<string, unknown> | undefined;
      return r ? rowToList(r) : null;
    },

    deleteList(id) { db.prepare("DELETE FROM lists WHERE id = ?").run(id); },

    addToList(listId, articleId) {
      db.prepare(`
        INSERT INTO list_items (list_id, article_id, added_at)
        VALUES (?, ?, ?)
        ON CONFLICT (list_id, article_id) DO NOTHING
      `).run(listId, articleId, new Date().toISOString());
    },

    removeFromList(listId, articleId) {
      db.prepare("DELETE FROM list_items WHERE list_id = ? AND article_id = ?").run(listId, articleId);
    },

    listListArticles(listId, limit): Article[] {
      const rows = db.prepare(`
        SELECT a.*, f.site_url AS feed_site_url, f.url AS feed_url
        FROM list_items li
        JOIN articles a ON a.id = li.article_id
        JOIN feeds f ON f.id = a.feed_id
        WHERE li.list_id = ?
        ORDER BY li.added_at DESC, li.rowid DESC
        LIMIT ?
      `).all(listId, limit) as Record<string, unknown>[];
      return rows.map((r) => rowToArticle(r, true));
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
          config = COALESCE(?, config),
          fetch_interval_min = COALESCE(?, fetch_interval_min),
          digest_mode = COALESCE(?, digest_mode),
          filter_threshold = COALESCE(?, filter_threshold),
          llm_enabled = COALESCE(?, llm_enabled)
        WHERE id = ?
      `).run(
        patch.config ? JSON.stringify(patch.config) : null,
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

    createCredential(userId, input): Credential {
      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO credentials (id, user_id, provider, label, origin, secret, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, userId, input.provider, input.label, input.origin, JSON.stringify(input.secret), now, now);
      return this.getCredential(id)!;
    },

    listCredentials(userId): Credential[] {
      const rows = db.prepare("SELECT * FROM credentials WHERE user_id = ? ORDER BY created_at").all(userId) as Record<string, unknown>[];
      return rows.map(rowToCredential);
    },

    getCredential(id): Credential | null {
      const r = db.prepare("SELECT * FROM credentials WHERE id = ?").get(id) as Record<string, unknown> | undefined;
      return r ? rowToCredential(r) : null;
    },

    updateCredentialSecret(id, secret) {
      db.prepare("UPDATE credentials SET secret = ?, updated_at = ? WHERE id = ?")
        .run(JSON.stringify(secret), new Date().toISOString(), id);
    },

    deleteCredential(id) { db.prepare("DELETE FROM credentials WHERE id = ?").run(id); },
  };
}
