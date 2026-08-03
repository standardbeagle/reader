import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Server } from "node:http";
import { createServer } from "../src/api/server.js";
import { startFixtureServer } from "./fixtureServer.js";
import type { FastifyInstance } from "fastify";

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
let baseUrl: string;

beforeEach(async () => {
  ({ server: fixture, baseUrl } = await startFixtureServer({
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

    const rd = await app.inject({ method: "POST", url: `/api/v1/articles/${a.id}/read`, payload: { read: true } });
    expect(rd.statusCode).toBe(204);

    const unread = await app.inject({ method: "GET", url: "/api/v1/articles?unread=1" });
    expect(unread.json().articles).toHaveLength(0);

    await app.inject({ method: "POST", url: `/api/v1/articles/${a.id}/read`, payload: { read: false } });
    const again = await app.inject({ method: "GET", url: "/api/v1/articles?unread=1" });
    expect(again.json().articles).toHaveLength(1);
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
