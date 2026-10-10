import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer } from "../src/api/server.js";
import type { FastifyInstance } from "fastify";
import { createSqliteStorage } from "../src/storage/sqlite.js";
import type { Storage } from "../src/storage/types.js";
import type { ParsedArticle } from "@reader/core";

const identity = (html: string) => html;

function article(guid: string, day: number, extra: Partial<ParsedArticle> = {}): ParsedArticle {
  return {
    guid, url: `https://example.com/${guid}`, title: guid, author: null,
    publishedAt: new Date(Date.UTC(2026, 6, day, 12)), contentHtml: "<p>x</p>", summary: null, ...extra,
  };
}

describe("feed kind and category", () => {
  let storage: Storage;
  let userId: string;
  beforeEach(() => {
    storage = createSqliteStorage(":memory:");
    userId = storage.getOrCreateLocalUser().id;
  });
  afterEach(() => storage.close());

  it("derives a feed's kind from its address and its media", () => {
    const blog = storage.createFeed(userId, { url: "https://blog.example.com/feed", title: "Blog", siteUrl: null });
    const pod = storage.createFeed(userId, { url: "https://pod.example.com/feed", title: "Pod", siteUrl: null });
    const vid = storage.createFeed(userId, { url: "https://vid.example.com/feed", title: "Vid", siteUrl: null });
    const tube = storage.createFeed(userId, { url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCx", title: "Tube", siteUrl: null });
    const social = storage.createFeed(userId, { url: "ingestor://mastodon/x", title: "Masto", siteUrl: null });
    storage.upsertArticles(blog.id, [article("b1", 1)], identity);
    storage.upsertArticles(pod.id, [article("p1", 1, { media: { url: "https://pod.example.com/1.mp3", type: "audio/mpeg" } })], identity);
    storage.upsertArticles(vid.id, [article("v1", 1, { media: { url: "https://vid.example.com/1.mp4", type: "video/mp4" } })], identity);

    const kinds = Object.fromEntries(storage.listFeeds(userId).map((f) => [f.title, f.kind]));
    expect(kinds).toEqual({ Blog: "article", Pod: "podcast", Vid: "video", Tube: "video", Masto: "social" });
    expect(storage.getFeed(tube.id)!.kind).toBe("video");
    expect(storage.getFeed(social.id)!.category).toBeNull();
  });

  it("filters articles by feed category, feed kind and media, in either order", () => {
    const blog = storage.createFeed(userId, { url: "https://blog.example.com/feed", title: "Blog", siteUrl: null, category: "Tech" });
    const pod = storage.createFeed(userId, { url: "https://pod.example.com/feed", title: "Pod", siteUrl: null });
    storage.setFeedCategory(pod.id, "Tech");
    const tube = storage.createFeed(userId, { url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCx", title: "Tube", siteUrl: null });
    storage.upsertArticles(blog.id, [article("b1", 1)], identity);
    storage.upsertArticles(pod.id, [
      article("p1", 2, { media: { url: "https://pod.example.com/1.mp3", type: "audio/mpeg" } }),
      article("p2", 3, { media: { url: "https://pod.example.com/2.mp4", type: "video/mp4" } }),
    ], identity);
    storage.upsertArticles(tube.id, [article("y1", 4, { url: "https://www.youtube.com/watch?v=abcdefghijk" })], identity);

    const titles = (q: Partial<Parameters<Storage["listArticles"]>[0]>) =>
      storage.listArticles({ userId, limit: 50, ...q }).map((a) => a.title);
    expect(titles({ feedCategory: "Tech" })).toEqual(["p2", "p1", "b1"]);
    expect(titles({ feedKind: "video" })).toEqual(["y1", "p2", "p1"]);
    expect(titles({ feedKind: "article" })).toEqual(["b1"]);
    expect(titles({ media: "any" })).toEqual(["y1", "p2", "p1"]);
    expect(titles({ media: "audio" })).toEqual(["p1"]);
    expect(titles({ media: "video" })).toEqual(["y1", "p2"]);
    expect(titles({ feedIds: [blog.id, tube.id] })).toEqual(["y1", "b1"]);
    expect(titles({ order: "oldest" })).toEqual(["b1", "p1", "p2", "y1"]);
    expect(titles({ maxAgeDays: 1 })).toEqual([]);
  });

  it("pages oldest-first without skipping or repeating", () => {
    const feed = storage.createFeed(userId, { url: "https://blog.example.com/feed", title: "Blog", siteUrl: null });
    storage.upsertArticles(feed.id, [1, 2, 3, 4, 5].map((d) => article(`a${d}`, d)), identity);
    const seen: string[] = [];
    let cursor: { before?: string; beforeId?: string } = {};
    for (;;) {
      const page = storage.listArticlePage({ userId, limit: 2, order: "oldest", ...cursor });
      seen.push(...page.articles.map((a) => a.title));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(["a1", "a2", "a3", "a4", "a5"]);
  });
});

describe("streams api", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await createServer({ dbPath: ":memory:", poller: false });
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  const OPML = `<opml version="2.0"><body>
    <outline text="News"><outline text="A" xmlUrl="https://a.invalid/feed"/></outline>
    <outline text="B" xmlUrl="https://b.invalid/feed"/>
  </body></opml>`;

  it("files imported feeds under their OPML folder and lets a category be changed", async () => {
    const imported = await app.inject({ method: "POST", url: "/api/v1/feeds/import", payload: { opml: OPML } });
    expect(imported.statusCode).toBe(201);
    const feeds = (await app.inject({ method: "GET", url: "/api/v1/feeds" })).json().feeds as { id: string; title: string; category: string | null; kind: string }[];
    expect(Object.fromEntries(feeds.map((f) => [f.title, f.category]))).toEqual({ A: "News", B: null });
    expect(feeds.every((f) => f.kind === "article")).toBe(true);

    const b = feeds.find((f) => f.title === "B")!;
    const set = await app.inject({ method: "PATCH", url: `/api/v1/feeds/${b.id}`, payload: { category: "  Longform " } });
    expect(set.statusCode).toBe(200);
    expect(set.json().category).toBe("Longform");
    const cleared = await app.inject({ method: "PATCH", url: `/api/v1/feeds/${b.id}`, payload: { category: null } });
    expect(cleared.json().category).toBeNull();

    expect((await app.inject({ method: "PATCH", url: `/api/v1/feeds/${b.id}`, payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: `/api/v1/feeds/${b.id}`, payload: { category: "x".repeat(61) } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: "/api/v1/feeds/nope", payload: { category: "x" } })).statusCode).toBe(404);
  });

  it("rejects unknown stream filters instead of ignoring them", async () => {
    for (const query of ["feed_kind=books", "media=gif", "order=random"]) {
      const res = await app.inject({ method: "GET", url: `/api/v1/articles?${query}` });
      expect(res.statusCode, query).toBe(400);
      expect(res.json().error.code).toBe("invalid_filter");
    }
    expect((await app.inject({ method: "GET", url: "/api/v1/articles?feed_kind=video&media=any&order=oldest" })).statusCode).toBe(200);
  });
});
