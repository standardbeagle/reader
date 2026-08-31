import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Server } from "node:http";
import { createServer } from "../src/api/server.js";
import { startFixtureServer } from "./fixtureServer.js";
import type { FastifyInstance } from "fastify";
import type { FixtureFeed } from "./fixtureServer.js";

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
<title>API Blog</title><link>https://api.example.com</link>
<item><title>A1</title><link>https://api.example.com/1</link>
<guid>a1</guid><pubDate>Wed, 01 Jul 2026 12:00:00 GMT</pubDate>
<description>&lt;p&gt;one&lt;/p&gt;</description></item>
</channel></rss>`;

const SITE_HTML = `<html><head>
<link rel="alternate" type="application/rss+xml" href="/feed.xml">
<link rel="alternate" type="application/atom+xml" href="/atom.xml">
</head><body>hi</body></html>`;

const PLAIN_HTML = `<html><head></head><body>plain</body></html>`;

let app: FastifyInstance;
let fixture: Server;
let fixtureState: Map<string, FixtureFeed>;
let baseUrl: string;

beforeEach(async () => {
  ({ server: fixture, baseUrl, state: fixtureState } = await startFixtureServer({
    "/feed.xml": { xml: RSS, etag: '"e1"' },
    "/site": { xml: SITE_HTML, contentType: "text/html" },
  }));
  app = await createServer({ dbPath: ":memory:", poller: false });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await new Promise((r) => fixture.close(r));
});

describe("api", () => {
  it("subscribes to a feed, fetching initial content", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/feeds",
      payload: { url: `${baseUrl}/feed.xml` },
    });
    expect(res.statusCode).toBe(201);
    const feed = res.json();
    expect(feed.title).toBe("API Blog");

    const list = await app.inject({ method: "GET", url: "/api/v1/feeds" });
    expect(list.json().feeds).toHaveLength(1);
    expect(list.json().feeds[0].unreadCount).toBe(1);
  });

  it("refreshes an existing feed through the refresh endpoint", async () => {
    const created = await app.inject({ method: "POST", url: "/api/v1/feeds", payload: { url: `${baseUrl}/feed.xml` } });
    const refresh = await app.inject({ method: "POST", url: `/api/v1/feeds/${created.json().id}/refresh` });
    expect(refresh.statusCode).toBe(200);
    expect(refresh.json().notModified).toBe(true);
    expect(refresh.json().feed.lastError).toBeNull();
  });

  it("rejects an unreachable feed with 422", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/feeds",
      payload: { url: `${baseUrl}/missing.xml` },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("feed_fetch_failed");

    const list = await app.inject({ method: "GET", url: "/api/v1/feeds" });
    expect(list.json().feeds).toHaveLength(0);
  });

  it("rejects duplicate subscription with 409", async () => {
    await app.inject({ method: "POST", url: "/api/v1/feeds", payload: { url: `${baseUrl}/feed.xml` } });
    const dup = await app.inject({ method: "POST", url: "/api/v1/feeds", payload: { url: `${baseUrl}/feed.xml` } });
    expect(dup.statusCode).toBe(409);
  });

  it("returns 409 when a redirecting url resolves to an already-subscribed feed", async () => {
    const redir = await startFixtureServer({
      "/old.xml": { xml: "", redirectTo: "/feed.xml" },
      "/feed.xml": { xml: RSS },
    });
    try {
      const created = await app.inject({
        method: "POST", url: "/api/v1/feeds",
        payload: { url: `${redir.baseUrl}/feed.xml` },
      });
      expect(created.statusCode).toBe(201);
      expect(created.json().url).toBe(`${redir.baseUrl}/feed.xml`);

      const dup = await app.inject({
        method: "POST", url: "/api/v1/feeds",
        payload: { url: `${redir.baseUrl}/old.xml` },
      });
      expect(dup.statusCode).toBe(409);
      const body = dup.json();
      expect(body.error.code).toBe("duplicate");
      expect(body.feed.url).toBe(`${redir.baseUrl}/feed.xml`);
    } finally {
      await new Promise((r) => redir.server.close(r));
    }
  });

  it("auto-subscribes when a site advertises exactly one feed", async () => {
    const one = await startFixtureServer({
      "/onesite": {
        xml: `<html><head><link rel="alternate" type="application/rss+xml" href="/only.xml"></head><body>x</body></html>`,
        contentType: "text/html",
      },
      "/only.xml": { xml: RSS },
    });
    try {
      const res = await app.inject({
        method: "POST", url: "/api/v1/feeds",
        payload: { url: `${one.baseUrl}/onesite` },
      });
      expect(res.statusCode).toBe(201);
      const feed = res.json();
      expect(feed.title).toBe("API Blog");
      expect(feed.url).toBe(`${one.baseUrl}/only.xml`);
    } finally {
      await new Promise((r) => one.server.close(r));
    }
  });

  it("lists articles and marks read/unread", async () => {
    await app.inject({ method: "POST", url: "/api/v1/feeds", payload: { url: `${baseUrl}/feed.xml` } });
    const arts = await app.inject({ method: "GET", url: "/api/v1/articles" });
    const [a] = arts.json().articles;
    expect(a.readAt).toBeNull();
    expect(a.contentHtml).toBeNull();

    const deep = await app.inject({ method: "GET", url: `/api/v1/articles/${a.id}` });
    expect(deep.statusCode).toBe(200);
    expect(deep.json().id).toBe(a.id);
    expect(deep.json().contentHtml).toContain("<p>one</p>");

    const expanded = await app.inject({ method: "GET", url: "/api/v1/articles?content=1" });
    expect(expanded.json().articles[0].contentHtml).toContain("<p>one</p>");

    const missing = await app.inject({ method: "GET", url: "/api/v1/articles/not-an-article" });
    expect(missing.statusCode).toBe(404);

    const rd = await app.inject({ method: "POST", url: `/api/v1/articles/${a.id}/read`, payload: { read: true } });
    expect(rd.statusCode).toBe(204);

    const unread = await app.inject({ method: "GET", url: "/api/v1/articles?unread=1" });
    expect(unread.json().articles).toHaveLength(0);

    await app.inject({ method: "POST", url: `/api/v1/articles/${a.id}/read`, payload: { read: false } });
    const again = await app.inject({ method: "GET", url: "/api/v1/articles?unread=1" });
    expect(again.json().articles).toHaveLength(1);
  });

  it("exposes category counts and filters articles by category", async () => {
    await app.inject({ method: "POST", url: "/api/v1/feeds", payload: { url: `${baseUrl}/feed.xml` } });
    const none = await app.inject({ method: "GET", url: "/api/v1/categories" });
    expect(none.json().categories).toEqual([]);

    const feed = (await app.inject({ method: "GET", url: "/api/v1/feeds" })).json().feeds[0];
    const rss = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Cat Blog</title><link>https://cat.example.com</link>
<item><title>C1</title><guid>cat-1</guid><category>World</category><category>Tech</category>
<pubDate>Wed, 01 Jul 2026 12:00:00 GMT</pubDate></item>
<item><title>C2</title><guid>cat-2</guid><category>World</category>
<pubDate>Tue, 30 Jun 2026 12:00:00 GMT</pubDate></item>
</channel></rss>`;
    const feedFixture = fixtureState.get("/feed.xml")!;
    feedFixture.xml = rss;
    delete feedFixture.etag;
    await app.inject({ method: "POST", url: `/api/v1/feeds/${feed.id}/refresh` });

    const counts = await app.inject({ method: "GET", url: `/api/v1/categories?feed_id=${feed.id}` });
    expect(counts.json().categories).toEqual([
      { name: "World", count: 2 }, { name: "Tech", count: 1 },
    ]);

    const world = await app.inject({ method: "GET", url: `/api/v1/articles?category=World` });
    expect(world.json().articles.map((a: { title: string }) => a.title)).toEqual(["C1", "C2"]);
    const tech = await app.inject({ method: "GET", url: `/api/v1/articles?category=Tech` });
    expect(tech.json().articles.map((a: { title: string }) => a.title)).toEqual(["C1"]);
  });

  it("returns a keyset cursor and pages without overlap", async () => {
    const rss = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Paged Blog</title><link>https://paged.example.com</link>
${[1, 2, 3].map((i) => `<item><title>P${i}</title><guid>paged-${i}</guid><pubDate>Wed, 0${i} Jul 2026 12:00:00 GMT</pubDate></item>`).join("\n")}
</channel></rss>`;
    const feedFixture = fixtureState.get("/feed.xml")!;
    feedFixture.xml = rss;
    delete feedFixture.etag;
    const created = await app.inject({ method: "POST", url: "/api/v1/feeds", payload: { url: `${baseUrl}/feed.xml` } });

    const page1 = await app.inject({ method: "GET", url: "/api/v1/articles?limit=2&feed_id=" + created.json().id });
    const body1 = page1.json();
    expect(body1.articles.map((a: { title: string }) => a.title)).toEqual(["P3", "P2"]);
    expect(body1.nextCursor).toEqual({ before: body1.articles[1].publishedAt, beforeId: body1.articles[1].id });

    const page2 = await app.inject({
      method: "GET",
      url: `/api/v1/articles?limit=2&feed_id=${created.json().id}&before=${encodeURIComponent(body1.nextCursor.before)}&before_id=${body1.nextCursor.beforeId}`,
    });
    const body2 = page2.json();
    expect(body2.articles.map((a: { title: string }) => a.title)).toEqual(["P1"]);
    expect(body2.nextCursor).toBeNull();
  });

  it("mark-all-read clears unread count", async () => {
    const created = await app.inject({ method: "POST", url: "/api/v1/feeds", payload: { url: `${baseUrl}/feed.xml` } });
    const feedId = created.json().id;
    const res = await app.inject({ method: "POST", url: `/api/v1/feeds/${feedId}/mark-all-read` });
    expect(res.statusCode).toBe(204);
    const list = await app.inject({ method: "GET", url: "/api/v1/feeds" });
    expect(list.json().feeds[0].unreadCount).toBe(0);
  });

  it("accepts empty body with json content-type on body-less POST", async () => {
    const created = await app.inject({ method: "POST", url: "/api/v1/feeds", payload: { url: `${baseUrl}/feed.xml` } });
    const feedId = created.json().id;
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/feeds/${feedId}/mark-all-read`,
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(204);
    const list = await app.inject({ method: "GET", url: "/api/v1/feeds" });
    expect(list.json().feeds[0].unreadCount).toBe(0);
  });

  it("unsubscribes and cascades", async () => {
    const created = await app.inject({ method: "POST", url: "/api/v1/feeds", payload: { url: `${baseUrl}/feed.xml` } });
    const feedId = created.json().id;
    const res = await app.inject({ method: "DELETE", url: `/api/v1/feeds/${feedId}` });
    expect(res.statusCode).toBe(204);
    const arts = await app.inject({ method: "GET", url: "/api/v1/articles" });
    expect(arts.json().articles).toHaveLength(0);
  });

  it("discovers feeds for a site url and returns choices", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/feeds",
      payload: { url: `${baseUrl}/site` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.needsChoice).toBe(true);
    expect(body.feeds.length).toBeGreaterThan(0);
    expect(body.feeds[0].url).toContain("/feed.xml");
  });

  it("returns 422 with no_feeds_found for a feedless site", async () => {
    const plain = await startFixtureServer({ "/plain": { xml: PLAIN_HTML, contentType: "text/html" } });
    try {
      const res = await app.inject({
        method: "POST", url: "/api/v1/feeds",
        payload: { url: `${plain.baseUrl}/plain` },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe("no_feeds_found");
    } finally {
      await new Promise((r) => plain.server.close(r));
    }
  });

  it("discover endpoint returns feeds list", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/feeds/discover",
      payload: { url: `${baseUrl}/site` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().feeds.length).toBeGreaterThan(0);
  });

  it("health endpoint returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.json()).toEqual({ ok: true });
  });
});
