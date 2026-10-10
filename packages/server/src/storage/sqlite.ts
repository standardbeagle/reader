import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Storage, User, Feed, Article, ArticleWithState, ArticleQuery, ArticlePage, FetchState,
  NormalizedItem, Ingestor, IngestorPatch, CategoryCount, SavedList, SavedListWithCount, ListRule, Settings,
  Credential, CredentialSecret,
} from "./types.js";
import { decodeHtmlEntities, looksLikeHtml, plainTextToHtml, sanitizeHtml, type ParsedArticle } from "@reader/core";

const LOCAL_USER_EMAIL = "local@reader";

// A feed's kind, from its address and whether it carries playable media. The
// inner alias is `ka` so this can sit inside queries that join articles as `a`;
// the range test on media_type is a prefix match the media index can seek.
const FEED_KIND_SQL = `CASE
  WHEN f.url LIKE 'ingestor://libby/%' THEN 'library'
  WHEN f.url LIKE 'ingestor://%' THEN 'social'
  WHEN f.url LIKE 'https://www.youtube.com/feeds/%'
    OR EXISTS (SELECT 1 FROM articles ka WHERE ka.feed_id = f.id AND ka.media_url IS NOT NULL
               AND ka.media_type >= 'video/' AND ka.media_type < 'video0') THEN 'video'
  WHEN EXISTS (SELECT 1 FROM articles ka WHERE ka.feed_id = f.id AND ka.media_url IS NOT NULL) THEN 'podcast'
  ELSE 'article' END`;
const FEED_SELECT = `SELECT f.*, ${FEED_KIND_SQL} AS kind FROM feeds f`;

// YouTube entries carry no enclosure; the link itself is the video.
const YOUTUBE_ARTICLE_SQL = `(a.url LIKE 'https://www.youtube.com/watch%' OR a.url LIKE 'https://www.youtube.com/shorts/%' OR a.url LIKE 'https://youtu.be/%')`;
const MEDIA_FILTER_SQL = {
  any: `(a.media_url IS NOT NULL OR ${YOUTUBE_ARTICLE_SQL})`,
  audio: `(a.media_url IS NOT NULL AND (a.media_type IS NULL OR a.media_type NOT LIKE 'video/%'))`,
  video: `(a.media_type LIKE 'video/%' OR ${YOUTUBE_ARTICLE_SQL})`,
} as const;

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
      category: (r.category as string) ?? null,
      kind: r.kind as Feed["kind"],
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

  /** The joins and WHERE terms an article query selects by, cursor excluded. */
  function articleFilter(q: ArticleQuery): { joins: string; clauses: string[]; params: unknown[] } {
    const clauses = ["f.user_id = ?"];
    const params: unknown[] = [q.userId, q.userId];
    if (q.feedId) { clauses.push("a.feed_id = ?"); params.push(q.feedId); }
    if (q.feedIds) {
      clauses.push(`a.feed_id IN (${q.feedIds.map(() => "?").join(", ")})`);
      params.push(...q.feedIds);
    }
    if (q.feedCategory) { clauses.push("f.category = ?"); params.push(q.feedCategory); }
    if (q.feedKind) { clauses.push(`${FEED_KIND_SQL} = ?`); params.push(q.feedKind); }
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
    if (q.media) clauses.push(MEDIA_FILTER_SQL[q.media]);
    if (q.maxAgeDays !== undefined) {
      clauses.push("a.published_at >= ?");
      params.push(new Date(Date.now() - q.maxAgeDays * 86_400_000).toISOString());
    }
    const joins = `
        JOIN feeds f ON f.id = a.feed_id
        ${q.listId ? "JOIN list_items li ON li.article_id = a.id" : ""}
        LEFT JOIN user_articles ua ON ua.article_id = a.id AND ua.user_id = ?`;
    return { joins, clauses, params };
  }

  function rowToList(r: Record<string, unknown>): SavedList {
    return {
      id: r.id as string, userId: r.user_id as string,
      title: r.title as string,
      visibility: r.visibility as SavedList["visibility"],
      token: r.token as string,
      rule: r.rule ? JSON.parse(r.rule as string) as ListRule : null,
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
      lastError: (r.last_error as string) ?? null,
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

    getSettings(userId): Settings {
      const r = db.prepare("SELECT libby_sync_enabled FROM users WHERE id = ?").get(userId) as { libby_sync_enabled: number } | undefined;
      if (!r) throw new Error("user not found: " + userId);
      return { libbySyncEnabled: r.libby_sync_enabled === 1 };
    },

    updateSettings(userId, patch): Settings {
      if (patch.libbySyncEnabled !== undefined) {
        db.prepare("UPDATE users SET libby_sync_enabled = ? WHERE id = ?").run(patch.libbySyncEnabled ? 1 : 0, userId);
      }
      return this.getSettings(userId);
    },

    createFeed(userId, input): Feed {
      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO feeds (id, user_id, url, title, site_url, credential_id, category, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, userId, input.url, input.title, input.siteUrl, input.credentialId ?? null, input.category ?? null, now);
      return this.getFeed(id)!;
    },

    listFeeds(userId): Feed[] {
      const rows = db.prepare(`${FEED_SELECT} WHERE f.user_id = ? ORDER BY f.title`).all(userId) as Record<string, unknown>[];
      return rows.map(rowToFeed);
    },

    getFeed(id): Feed | null {
      const r = db.prepare(`${FEED_SELECT} WHERE f.id = ?`).get(id) as Record<string, unknown> | undefined;
      return r ? rowToFeed(r) : null;
    },

    setFeedCategory(id, category) {
      db.prepare("UPDATE feeds SET category = ? WHERE id = ?").run(category, id);
    },

    deleteFeed(id) { db.prepare("DELETE FROM feeds WHERE id = ?").run(id); },

    dueFeeds(now): Feed[] {
      // julianday handles ISO strings with 'T'/'Z'; string comparison against
      // datetime() output (space separator) would misorder.
      const rows = db.prepare(`
        ${FEED_SELECT}
        WHERE f.url NOT LIKE 'ingestor://%' AND (
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
      return this.listArticlePage(q).articles;
    },

    listArticlePage(q: ArticleQuery): ArticlePage {
      const list = q.listId ? this.getList(q.listId) : null;
      if (list?.rule) {
        // A dynamic list has no members: its rule is the query.
        const { listId: _listId, ...rest } = q;
        return this.listArticlePage({ ...rest, ...list.rule, order: list.rule.order ?? "newest" });
      }
      const includeContent = q.includeContent !== false;
      const order = q.order ?? (q.listId ? "position" : "newest");
      if (order === "position" && !q.listId) throw new Error("position order needs a manual list");
      const { joins, clauses, params } = articleFilter(q);
      // Keyset cursor over (sort key, id): the id half keeps articles that
      // share the boundary value from being skipped between pages. The id
      // comparison follows the ORDER BY tiebreak (ascending within a key), so
      // continuation means id > cursor id.
      const sortKey = order === "position" ? "li.position" : "a.published_at";
      const past = order === "newest" ? "<" : ">";
      if (q.before) {
        const before = order === "position" ? Number(q.before) : q.before;
        if (q.beforeId) {
          clauses.push(`(${sortKey} ${past} ? OR (${sortKey} = ? AND a.id > ?))`);
          params.push(before, before, q.beforeId);
        } else {
          clauses.push(`${sortKey} ${past} ?`);
          params.push(before);
        }
      }
      params.push(q.limit);
      const articleColumns = includeContent
        ? "a.*, f.site_url AS feed_site_url, f.url AS feed_url"
        : `a.id, a.feed_id, a.guid, a.url, a.title, a.author, a.published_at,
           NULL AS content_html, NULL AS summary, a.image_url, a.categories, a.media_url, a.media_type, a.fetched_at`;
      // Ordering must stay aligned with the keyset cursor above: (sort key,
      // id) both directions included, so no page boundary can skip or repeat
      // a row. fetched_at is deliberately not a tiebreak — it changes on
      // refresh and would corrupt the cursor position.
      const orderBy = order === "position"
        ? "li.position, a.id"
        : `a.published_at IS NULL, a.published_at ${order === "oldest" ? "ASC" : "DESC"}, a.id`;
      const rows = db.prepare(`
        SELECT ${articleColumns}, ua.read_at, ua.snoozed_until${order === "position" ? ", li.position AS list_position" : ""}
        FROM articles a ${joins}
        WHERE ${clauses.join(" AND ")}
        ORDER BY ${orderBy}
        LIMIT ?
      `).all(...params) as Record<string, unknown>[];
      const articles = rows.map((r) => ({
        ...rowToArticle(r, includeContent),
        readAt: (r.read_at as string) ?? null,
        snoozedUntil: (r.snoozed_until as string) ?? null,
      }));
      // Full page = assume more exist; the cursor is the last row's keyset position.
      const last = rows.length === q.limit ? rows[rows.length - 1] : undefined;
      const before = last && (order === "position" ? String(last.list_position) : last.published_at as string | null);
      return { articles, nextCursor: last && before ? { before, beforeId: last.id as string } : null };
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
      db.prepare(`INSERT INTO lists (id, user_id, title, visibility, token, rule, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(id, userId, input.title, input.visibility, token, input.rule ? JSON.stringify(input.rule) : null, new Date().toISOString());
      return this.getList(id)!;
    },

    updateList(id, patch): SavedList {
      db.prepare(`
        UPDATE lists SET
          title = COALESCE(?, title),
          visibility = COALESCE(?, visibility),
          rule = COALESCE(?, rule)
        WHERE id = ?
      `).run(patch.title ?? null, patch.visibility ?? null, patch.rule ? JSON.stringify(patch.rule) : null, id);
      const updated = this.getList(id);
      if (!updated) throw new Error("list not found: " + id);
      return updated;
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
      return rows.map((r) => {
        const list = rowToList(r);
        if (!list.rule) return { ...list, itemCount: r.item_count as number };
        // A dynamic list has no rows to count; count what its rule matches now.
        const { joins, clauses, params } = articleFilter({ userId, limit: 0, ...list.rule });
        const matched = db.prepare(`SELECT COUNT(*) AS n FROM articles a ${joins} WHERE ${clauses.join(" AND ")}`)
          .get(...params) as { n: number };
        return { ...list, itemCount: matched.n };
      });
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
        INSERT INTO list_items (list_id, article_id, added_at, position)
        VALUES (?, ?, ?, (SELECT COALESCE(MAX(position) + 1, 0) FROM list_items WHERE list_id = ?))
        ON CONFLICT (list_id, article_id) DO NOTHING
      `).run(listId, articleId, new Date().toISOString(), listId);
    },

    setListItems(listId, articleIds) {
      const savedAt = new Map((db.prepare("SELECT article_id, added_at FROM list_items WHERE list_id = ?")
        .all(listId) as { article_id: string; added_at: string }[]).map((r) => [r.article_id, r.added_at]));
      const clear = db.prepare("DELETE FROM list_items WHERE list_id = ?");
      const insert = db.prepare("INSERT INTO list_items (list_id, article_id, added_at, position) VALUES (?, ?, ?, ?)");
      const now = new Date().toISOString();
      db.transaction(() => {
        clear.run(listId);
        // An article kept across the replacement keeps the time it was saved.
        [...new Set(articleIds)].forEach((articleId, position) => insert.run(listId, articleId, savedAt.get(articleId) ?? now, position));
      })();
    },

    removeFromList(listId, articleId) {
      db.prepare("DELETE FROM list_items WHERE list_id = ? AND article_id = ?").run(listId, articleId);
    },

    listListArticles(listId, limit): Article[] {
      const list = this.getList(listId);
      if (list?.rule) return this.listArticles({ userId: list.userId, listId, limit, includeSnoozed: true });
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
        SELECT i.* FROM ingestors i
        JOIN users u ON u.id = i.user_id
        WHERE i.status = 'ok'
          AND (i.kind <> 'libby' OR u.libby_sync_enabled = 1)
          AND (i.last_fetched_at IS NULL
               OR julianday(i.last_fetched_at) <= julianday(?) - i.fetch_interval_min / 1440.0)
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
          status = ?,
          last_error = CASE WHEN ? THEN ? ELSE last_error END
        WHERE id = ?
      `).run(
        state.lastFetchedAt ?? null, state.lastDeliveredAt ?? null,
        state.cursor === undefined ? null : JSON.stringify(state.cursor),
        state.errorCount, state.status,
        state.lastError === undefined ? 0 : 1, state.lastError ?? null, id,
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
