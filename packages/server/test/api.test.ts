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

let app: FastifyInstance;
let fixture: Server;
let baseUrl: string;

beforeEach(async () => {
  ({ server: fixture, baseUrl } = await startFixtureServer({ "/feed.xml": { xml: RSS, etag: '"e1"' } }));
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
  });

  it("rejects duplicate subscription with 409", async () => {
    await app.inject({ method: "POST", url: "/api/v1/feeds", payload: { url: `${baseUrl}/feed.xml` } });
    const dup = await app.inject({ method: "POST", url: "/api/v1/feeds", payload: { url: `${baseUrl}/feed.xml` } });
    expect(dup.statusCode).toBe(409);
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

  it("unsubscribes and cascades", async () => {
    const created = await app.inject({ method: "POST", url: "/api/v1/feeds", payload: { url: `${baseUrl}/feed.xml` } });
    const feedId = created.json().id;
    const res = await app.inject({ method: "DELETE", url: `/api/v1/feeds/${feedId}` });
    expect(res.statusCode).toBe(204);
    const arts = await app.inject({ method: "GET", url: "/api/v1/articles" });
    expect(arts.json().articles).toHaveLength(0);
  });

  it("health endpoint returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.json()).toEqual({ ok: true });
  });
});
