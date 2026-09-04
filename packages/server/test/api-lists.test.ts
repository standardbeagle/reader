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

let app: FastifyInstance;
let fixture: Server;
let fixtureState: Map<string, FixtureFeed>;
let baseUrl: string;

beforeEach(async () => {
  ({ server: fixture, baseUrl, state: fixtureState } = await startFixtureServer({
    "/feed.xml": { xml: RSS, etag: '"e1"' },
  }));
  app = await createServer({ dbPath: ":memory:", poller: false });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await new Promise((r) => fixture.close(r));
});

async function subscribeAndGetArticle(): Promise<{ feedId: string; articleId: string }> {
  const created = await app.inject({ method: "POST", url: "/api/v1/feeds", payload: { url: `${baseUrl}/feed.xml` } });
  const feedId = created.json().id as string;
  const articles = await app.inject({ method: "GET", url: "/api/v1/articles" });
  return { feedId, articleId: articles.json().articles[0].id as string };
}

describe("snooze api", () => {
  it("snoozes and unsnoozes an article, hiding it from the default list", async () => {
    const { feedId, articleId } = await subscribeAndGetArticle();
    const until = new Date(Date.now() + 3_600_000).toISOString();

    const snooze = await app.inject({ method: "POST", url: `/api/v1/articles/${articleId}/snooze`, payload: { until } });
    expect(snooze.statusCode).toBe(204);

    const list = await app.inject({ method: "GET", url: "/api/v1/articles" });
    expect(list.json().articles).toHaveLength(0);
    const withSnoozed = await app.inject({ method: "GET", url: "/api/v1/articles?snoozed=1" });
    expect(withSnoozed.json().articles).toHaveLength(1);
    expect(withSnoozed.json().articles[0].snoozedUntil).toBe(until);

    const feeds = await app.inject({ method: "GET", url: "/api/v1/feeds" });
    expect(feeds.json().feeds.find((f: { id: string }) => f.id === feedId).unreadCount).toBe(0);

    const unsnooze = await app.inject({ method: "POST", url: `/api/v1/articles/${articleId}/snooze`, payload: { until: null } });
    expect(unsnooze.statusCode).toBe(204);
    const restored = await app.inject({ method: "GET", url: "/api/v1/articles" });
    expect(restored.json().articles).toHaveLength(1);
    expect(restored.json().articles[0].readAt).toBeNull();
  });

  it("rejects an invalid until value and unknown articles", async () => {
    const { articleId } = await subscribeAndGetArticle();
    const bad = await app.inject({ method: "POST", url: `/api/v1/articles/${articleId}/snooze`, payload: { until: "not a date" } });
    expect(bad.statusCode).toBe(400);
    const missing = await app.inject({ method: "POST", url: "/api/v1/articles/nope/snooze", payload: { until: null } });
    expect(missing.statusCode).toBe(404);
  });
});

describe("lists api", () => {
  it("creates lists, adds and removes articles, and filters by list", async () => {
    const { articleId } = await subscribeAndGetArticle();
    const created = await app.inject({ method: "POST", url: "/api/v1/lists", payload: { title: "Read later", visibility: "private" } });
    expect(created.statusCode).toBe(201);
    const list = created.json();

    const add = await app.inject({ method: "POST", url: `/api/v1/lists/${list.id}/items`, payload: { articleId } });
    expect(add.statusCode).toBe(204);

    const lists = await app.inject({ method: "GET", url: "/api/v1/lists" });
    expect(lists.json().lists).toHaveLength(1);
    expect(lists.json().lists[0].itemCount).toBe(1);

    const article = await app.inject({ method: "GET", url: `/api/v1/articles/${articleId}` });
    expect(article.json().listIds).toEqual([list.id]);

    const filtered = await app.inject({ method: "GET", url: `/api/v1/articles?list_id=${list.id}` });
    expect(filtered.json().articles.map((a: { id: string }) => a.id)).toEqual([articleId]);

    const remove = await app.inject({ method: "DELETE", url: `/api/v1/lists/${list.id}/items/${articleId}` });
    expect(remove.statusCode).toBe(204);
    const empty = await app.inject({ method: "GET", url: `/api/v1/articles?list_id=${list.id}` });
    expect(empty.json().articles).toHaveLength(0);

    const del = await app.inject({ method: "DELETE", url: `/api/v1/lists/${list.id}` });
    expect(del.statusCode).toBe(204);
  });

  it("validates list input", async () => {
    const noTitle = await app.inject({ method: "POST", url: "/api/v1/lists", payload: { title: " " } });
    expect(noTitle.statusCode).toBe(400);
    const badVisibility = await app.inject({ method: "POST", url: "/api/v1/lists", payload: { title: "x", visibility: "friends" } });
    expect(badVisibility.statusCode).toBe(400);
    const missing = await app.inject({ method: "DELETE", url: "/api/v1/lists/nope" });
    expect(missing.statusCode).toBe(404);
  });

  it("serves a public list as RSS and hides private lists", async () => {
    const { articleId } = await subscribeAndGetArticle();
    const pub = (await app.inject({ method: "POST", url: "/api/v1/lists", payload: { title: "Public & Co", visibility: "public" } })).json();
    const priv = (await app.inject({ method: "POST", url: "/api/v1/lists", payload: { title: "Secret", visibility: "private" } })).json();
    await app.inject({ method: "POST", url: `/api/v1/lists/${pub.id}/items`, payload: { articleId } });

    const feed = await app.inject({ method: "GET", url: `/lists/${pub.token}.xml` });
    expect(feed.statusCode).toBe(200);
    expect(feed.headers["content-type"]).toContain("application/rss+xml");
    expect(feed.body).toContain("<title>Public &amp; Co</title>");
    expect(feed.body).toContain("<title>A1</title>");
    expect(feed.body).toContain("<link>https://api.example.com/1</link>");
    expect(feed.body).toContain("<p>one</p>");

    const hidden = await app.inject({ method: "GET", url: `/lists/${priv.token}.xml` });
    expect(hidden.statusCode).toBe(404);
    const unknown = await app.inject({ method: "GET", url: "/lists/no-such-token.xml" });
    expect(unknown.statusCode).toBe(404);
  });
});
