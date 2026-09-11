import type { FastifyInstance, FastifyReply } from "fastify";
import { parseOpml, parseYoutubeTakeout, type FeedOutline } from "@reader/core";
import type { Storage } from "../storage/types.js";
import type { Poller } from "../poller/poller.js";
import { discoverFeeds } from "../discovery/discover.js";

const MAX_IMPORT_FEEDS = 500;
const IMPORT_CONCURRENCY = 4;

interface SubscribeBody { url?: string; credentialId?: string }
interface ReadBody { read?: boolean }
interface SnoozeBody { until?: string | null }
interface ArticleQuery { feed_id?: string; list_id?: string; unread?: string; category?: string; before?: string; before_id?: string; limit?: string; content?: string; snoozed?: string }

export function registerRoutes(app: FastifyInstance, storage: Storage, poller: Poller): void {
  const userId = () => storage.getOrCreateLocalUser().id;

  app.get("/api/v1/health", async () => ({ ok: true }));

  app.post<{ Params: { id: string } }>("/api/v1/feeds/:id/refresh", async (req, reply) => {
    const feed = storage.getFeed(req.params.id);
    if (!feed) {
      return reply.code(404).send({ error: { code: "not_found", message: "feed not found" } });
    }
    if (feed.url.startsWith("ingestor://")) {
      return reply.code(409).send({ error: { code: "feed_managed", message: "this feed is refreshed by its ingestor" } });
    }
    const result = await poller.refreshFeed(feed.id);
    const updated = storage.getFeed(feed.id);
    if (result.error) {
      return reply.code(502).send({
        error: { code: "feed_refresh_failed", message: result.error },
        feed: updated,
      });
    }
    return { feed: updated, ...result };
  });

  app.post<{ Body: SubscribeBody }>("/api/v1/feeds/discover", async (req, reply) => {
    const url = req.body?.url?.trim();
    if (!url || !/^https?:\/\//.test(url)) {
      return reply.code(400).send({ error: { code: "invalid_url", message: "url must be http(s)" } });
    }
    try {
      const feeds = await discoverFeeds(url);
      return { feeds };
    } catch (e) {
      return reply.code(422).send({ error: { code: "feed_fetch_failed", message: e instanceof Error ? e.message : String(e) } });
    }
  });

  app.post<{ Body: SubscribeBody }>("/api/v1/feeds", async (req, reply) => {
    const url = req.body?.url?.trim();
    if (!url || !/^https?:\/\//.test(url)) {
      return reply.code(400).send({ error: { code: "invalid_url", message: "url must be http(s)" } });
    }
    const uid = userId();
    const existing = storage.listFeeds(uid).find((f) => f.url === url);
    if (existing) {
      return reply.code(409).send({ error: { code: "duplicate", message: "already subscribed" }, feed: existing });
    }
    if (req.body?.credentialId) return subscribeAuthenticated(url, req.body.credentialId, reply);
    let feeds;
    try {
      feeds = await discoverFeeds(url);
    } catch (e) {
      return reply.code(422).send({ error: { code: "feed_fetch_failed", message: e instanceof Error ? e.message : String(e) } });
    }
    const direct = feeds.find((f) => f.url === url) ?? (feeds.length === 1 ? feeds[0] : null);
    if (!direct) {
      if (feeds.length === 0) {
        return reply.code(422).send({ error: { code: "no_feeds_found", message: "no RSS or Atom feeds found at that URL" } });
      }
      return reply.code(200).send({ needsChoice: true, feeds });
    }
    const resolved = storage.listFeeds(uid).find((f) => f.url === direct.url);
    if (resolved) {
      return reply.code(409).send({ error: { code: "duplicate", message: "already subscribed" }, feed: resolved });
    }
    let feed;
    try {
      feed = storage.createFeed(uid, { url: direct.url, title: direct.title, siteUrl: url });
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      if (typeof code === "string" && code.startsWith("SQLITE_CONSTRAINT")) {
        const existingFeed = storage.listFeeds(uid).find((f) => f.url === direct.url);
        return reply.code(409).send({ error: { code: "duplicate", message: "already subscribed" }, ...(existingFeed ? { feed: existingFeed } : {}) });
      }
      throw e;
    }
    const result = await poller.refreshFeed(feed.id);
    if (result.error) {
      storage.deleteFeed(feed.id);
      return reply.code(422).send({ error: { code: "feed_fetch_failed", message: result.error } });
    }
    return reply.code(201).send(storage.getFeed(feed.id));
  });

  // A credential belongs to one feed address, so discovery (which probes other
  // paths and follows <link> tags) is skipped: the URL must be the feed itself.
  const subscribeAuthenticated = async (url: string, credentialId: string, reply: FastifyReply) => {
    const credential = storage.getCredential(credentialId);
    if (!credential) {
      return reply.code(400).send({ error: { code: "invalid_credential", message: "credential not found" } });
    }
    if (new URL(url).origin !== credential.origin) {
      return reply.code(400).send({ error: { code: "invalid_credential", message: `${credential.label} signs in to ${credential.origin}, not this feed's host` } });
    }
    const feed = storage.createFeed(userId(), { url, title: new URL(url).host, siteUrl: null, credentialId });
    const result = await poller.refreshFeed(feed.id);
    if (result.error) {
      storage.deleteFeed(feed.id);
      return reply.code(422).send({ error: { code: "feed_fetch_failed", message: result.error } });
    }
    return reply.code(201).send(storage.getFeed(feed.id));
  };

  // Imports create every outline as a feed, then refresh in the background
  // with bounded concurrency. Awaiting hundreds of fetches would blow the
  // request timeout; feeds surface as they finish their first fetch.
  const importFeedOutlines = (outlines: FeedOutline[]) => {
    const uid = userId();
    const existing = new Set(storage.listFeeds(uid).map((f) => f.url));
    const added = [];
    const skipped = [];
    for (const outline of outlines) {
      if (!/^https?:\/\//.test(outline.xmlUrl)) {
        skipped.push({ title: outline.title, url: outline.xmlUrl, reason: "invalid_url" });
        continue;
      }
      if (existing.has(outline.xmlUrl)) {
        skipped.push({ title: outline.title, url: outline.xmlUrl, reason: "duplicate" });
        continue;
      }
      existing.add(outline.xmlUrl);
      const feed = storage.createFeed(uid, { url: outline.xmlUrl, title: outline.title, siteUrl: outline.htmlUrl });
      added.push(storage.getFeed(feed.id));
    }
    const queue = [...added];
    const workers = Array.from({ length: IMPORT_CONCURRENCY }, async () => {
      for (let feed; (feed = queue.shift()); ) {
        await poller.refreshFeed(feed.id).catch(() => { /* failure shows as broken feed status */ });
      }
    });
    void Promise.all(workers).catch(() => {});
    return { added, skipped };
  };

  const importLimitError = (outlines: FeedOutline[], source: string) => {
    if (outlines.length === 0) {
      return { code: "no_feeds_found", message: `no feeds found in that ${source}` };
    }
    if (outlines.length > MAX_IMPORT_FEEDS) {
      return { code: "too_many_feeds", message: `import is capped at ${MAX_IMPORT_FEEDS} feeds` };
    }
    return null;
  };

  app.post<{ Body: { opml?: string } }>("/api/v1/feeds/import", async (req, reply) => {
    const opml = req.body?.opml;
    if (!opml || typeof opml !== "string") {
      return reply.code(400).send({ error: { code: "invalid_opml", message: "body must be { opml: string }" } });
    }
    let outlines;
    try {
      outlines = await parseOpml(opml);
    } catch {
      return reply.code(400).send({ error: { code: "invalid_opml", message: "could not parse that OPML file" } });
    }
    const limitError = importLimitError(outlines, "OPML file");
    if (limitError) return reply.code(422).send({ error: limitError });
    return reply.code(201).send(importFeedOutlines(outlines));
  });

  // YouTube has no subscriptions feed; Takeout's subscriptions.csv lists the
  // channel ids, each of which has its own Atom feed.
  app.post<{ Body: { csv?: string } }>("/api/v1/feeds/import/youtube", async (req, reply) => {
    const csv = req.body?.csv;
    if (!csv || typeof csv !== "string") {
      return reply.code(400).send({ error: { code: "invalid_takeout", message: "body must be { csv: string }" } });
    }
    let outlines;
    try {
      outlines = parseYoutubeTakeout(csv);
    } catch (e) {
      return reply.code(400).send({ error: { code: "invalid_takeout", message: e instanceof Error ? e.message : String(e) } });
    }
    const limitError = importLimitError(outlines, "subscriptions file");
    if (limitError) return reply.code(422).send({ error: limitError });
    return reply.code(201).send(importFeedOutlines(outlines));
  });

  app.get("/api/v1/feeds", async () => {
    const uid = userId();
    const counts = storage.unreadCounts(uid);
    return {
      feeds: storage.listFeeds(uid).map((f) => ({
        ...f, unreadCount: counts[f.id] ?? 0,
      })),
    };
  });

  app.delete<{ Params: { id: string } }>("/api/v1/feeds/:id", async (req, reply) => {
    if (!storage.getFeed(req.params.id)) {
      return reply.code(404).send({ error: { code: "not_found", message: "feed not found" } });
    }
    storage.deleteFeed(req.params.id);
    return reply.code(204).send();
  });

  app.get<{ Querystring: ArticleQuery }>("/api/v1/articles", async (req) => {
    const limit = Math.max(1, Math.min(Number(req.query.limit ?? 50) || 50, 200));
    const articles = storage.listArticles({
      userId: userId(),
      ...(req.query.feed_id ? { feedId: req.query.feed_id } : {}),
      ...(req.query.list_id ? { listId: req.query.list_id } : {}),
      unreadOnly: req.query.unread === "1",
      includeSnoozed: req.query.snoozed === "1",
      ...(req.query.category ? { category: req.query.category } : {}),
      ...(req.query.before ? { before: req.query.before } : {}),
      ...(req.query.before_id ? { beforeId: req.query.before_id } : {}),
      limit,
      includeContent: req.query.content === "1",
    });
    // Full page = assume more exist; cursor is the last row's keyset position.
    const last = articles.length === limit ? articles[articles.length - 1] : undefined;
    const nextCursor = last?.publishedAt ? { before: last.publishedAt, beforeId: last.id } : null;
    return { articles, nextCursor };
  });

  app.get<{ Querystring: { feed_id?: string } }>("/api/v1/categories", async (req) => {
    const categories = storage.listCategories(userId(), req.query.feed_id || undefined);
    return { categories };
  });

  app.get<{ Params: { id: string } }>("/api/v1/articles/:id", async (req, reply) => {
    const article = storage.getArticle(userId(), req.params.id);
    if (!article) {
      return reply.code(404).send({ error: { code: "not_found", message: "article not found" } });
    }
    return article;
  });

  app.post<{ Params: { id: string }; Body: ReadBody }>("/api/v1/articles/:id/read", async (req, reply) => {
    storage.setRead(userId(), req.params.id, req.body?.read !== false);
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string }; Body: SnoozeBody }>("/api/v1/articles/:id/snooze", async (req, reply) => {
    const uid = userId();
    if (!storage.getArticle(uid, req.params.id)) {
      return reply.code(404).send({ error: { code: "not_found", message: "article not found" } });
    }
    const raw = req.body?.until;
    if (raw === null || raw === undefined) {
      storage.setSnooze(uid, req.params.id, null);
      return reply.code(204).send();
    }
    const until = new Date(raw);
    if (Number.isNaN(until.getTime())) {
      return reply.code(400).send({ error: { code: "invalid_until", message: "until must be an ISO date or null" } });
    }
    storage.setSnooze(uid, req.params.id, until);
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>("/api/v1/feeds/:id/mark-all-read", async (req, reply) => {
    if (!storage.getFeed(req.params.id)) {
      return reply.code(404).send({ error: { code: "not_found", message: "feed not found" } });
    }
    storage.markAllRead(userId(), req.params.id);
    return reply.code(204).send();
  });
}
