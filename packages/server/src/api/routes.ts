import type { FastifyInstance } from "fastify";
import type { Storage } from "../storage/types.js";
import type { Poller } from "../poller/poller.js";
import { discoverFeeds } from "../discovery/discover.js";

interface SubscribeBody { url?: string }
interface ReadBody { read?: boolean }
interface ArticleQuery { feed_id?: string; unread?: string; category?: string; before?: string; before_id?: string; limit?: string; content?: string }

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
      unreadOnly: req.query.unread === "1",
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

  app.post<{ Params: { id: string } }>("/api/v1/feeds/:id/mark-all-read", async (req, reply) => {
    if (!storage.getFeed(req.params.id)) {
      return reply.code(404).send({ error: { code: "not_found", message: "feed not found" } });
    }
    storage.markAllRead(userId(), req.params.id);
    return reply.code(204).send();
  });
}
