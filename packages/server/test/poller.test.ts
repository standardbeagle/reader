import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Server } from "node:http";
import { createSqliteStorage } from "../src/storage/sqlite.js";
import { Poller, MAX_FEED_BYTES } from "../src/poller/poller.js";
import { startFixtureServer } from "./fixtureServer.js";
import type { Storage } from "../src/storage/types.js";

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
<title>Fixture Blog</title><link>https://fixture.example.com</link>
<item><title>P1</title><link>https://fixture.example.com/1</link>
<guid>g1</guid><pubDate>Wed, 01 Jul 2026 12:00:00 GMT</pubDate>
<description>&lt;p&gt;one&lt;/p&gt;</description></item>
</channel></rss>`;

let storage: Storage;
let server: Server;
let baseUrl: string;
let state: Map<string, import("./fixtureServer.js").FixtureFeed>;

beforeEach(async () => {
  storage = createSqliteStorage(":memory:");
  ({ server, baseUrl, state } = await startFixtureServer({
    "/feed.xml": { xml: RSS, etag: '"v1"' },
    "/broken.xml": { xml: "", statusOnRequest: 500 },
    "/huge.xml": { xml: "", rawBody: "x".repeat(MAX_FEED_BYTES + 1024) },
  }));
});

afterEach(async () => {
  storage.close();
  await new Promise((r) => server.close(r));
});

function subscribe(url: string) {
  const user = storage.getOrCreateLocalUser();
  return { user, feed: storage.createFeed(user.id, { url, title: url, siteUrl: null }) };
}

describe("Poller.refreshFeed", () => {
  it("fetches, parses, inserts articles and updates feed state", async () => {
    const { user, feed } = subscribe(`${baseUrl}/feed.xml`);
    const poller = new Poller(storage);
    const result = await poller.refreshFeed(feed.id);
    expect(result.newArticles).toBe(1);
    const updated = storage.getFeed(feed.id)!;
    expect(updated.title).toBe("Fixture Blog");
    expect(updated.etag).toBe('"v1"');
    expect(updated.errorCount).toBe(0);
    expect(updated.fetchIntervalMin).toBe(30); // halved from default 60
    expect(storage.listArticles({ userId: user.id, limit: 50 })).toHaveLength(1);
  });

  it("sends conditional headers and handles 304", async () => {
    const { feed } = subscribe(`${baseUrl}/feed.xml`);
    const poller = new Poller(storage);
    await poller.refreshFeed(feed.id);
    const result = await poller.refreshFeed(feed.id);
    expect(result.newArticles).toBe(0);
    expect(result.notModified).toBe(true);
    const updated = storage.getFeed(feed.id)!;
    expect(updated.fetchIntervalMin).toBe(60); // doubled back from 30
  });

  it("increments error count on failure without deleting articles", async () => {
    const { user, feed } = subscribe(`${baseUrl}/feed.xml`);
    const poller = new Poller(storage);
    await poller.refreshFeed(feed.id);
    const broken = storage.createFeed(user.id, { url: `${baseUrl}/broken.xml`, title: "b", siteUrl: null });
    const result = await poller.refreshFeed(broken.id);
    expect(result.error).toBeTruthy();
    expect(storage.getFeed(broken.id)!.errorCount).toBe(1);
    expect(storage.listArticles({ userId: user.id, limit: 50 })).toHaveLength(1);
  });

  it("marks feed broken after 10 consecutive errors", async () => {
    const { feed } = subscribe(`${baseUrl}/broken.xml`);
    const poller = new Poller(storage);
    for (let i = 0; i < 10; i++) await poller.refreshFeed(feed.id);
    expect(storage.getFeed(feed.id)!.status).toBe("broken");
  });

  it("recovers a broken feed when the source becomes healthy", async () => {
    const { feed } = subscribe(`${baseUrl}/broken.xml`);
    const poller = new Poller(storage);
    for (let i = 0; i < 10; i++) await poller.refreshFeed(feed.id);
    expect(storage.getFeed(feed.id)!.status).toBe("broken");

    const source = state.get("/broken.xml")!;
    delete source.statusOnRequest;
    source.xml = RSS;
    const result = await poller.refreshFeed(feed.id);

    expect(result.error).toBeUndefined();
    expect(storage.getFeed(feed.id)!.status).toBe("ok");
    expect(storage.getFeed(feed.id)!.errorCount).toBe(0);
    expect(storage.getFeed(feed.id)!.lastError).toBeNull();
    expect(storage.listArticles({ userId: storage.getOrCreateLocalUser().id, limit: 50 })).toHaveLength(1);
  });

  it("automatically retries a broken feed after its recovery interval", async () => {
    const { feed } = subscribe(`${baseUrl}/broken.xml`);
    const poller = new Poller(storage);
    for (let i = 0; i < 10; i++) await poller.refreshFeed(feed.id);
    const source = state.get("/broken.xml")!;
    delete source.statusOnRequest;
    source.xml = RSS;
    storage.updateFeedFetchState(feed.id, {
      lastFetchedAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
      fetchIntervalMin: 60,
      errorCount: 10,
      status: "broken",
    });

    await poller.tick();

    expect(storage.getFeed(feed.id)!.status).toBe("ok");
    expect(source.requestCount).toBe(11);
  });

  it("rejects bodies over the size cap and counts the error", async () => {
    const { feed } = subscribe(`${baseUrl}/huge.xml`);
    const poller = new Poller(storage);
    const result = await poller.refreshFeed(feed.id);
    expect(result.error).toMatch(/too large/);
    expect(storage.getFeed(feed.id)!.errorCount).toBe(1);
  });
});

describe("Poller.tick", () => {
  it("leaves a rate-limited feed alone until its Retry-After passes", async () => {
    state.set("/limited.xml", { xml: "", statusOnRequest: 429, headers: { "retry-after": "600" }, requestCount: 0 });
    const { feed } = subscribe(`${baseUrl}/limited.xml`);
    const poller = new Poller(storage);
    const result = await poller.refreshFeed(feed.id);
    expect(result.error).toMatch(/^HTTP 429 \(retry after /);
    const retryAfter = Date.parse(storage.getFeed(feed.id)!.retryAfter!);
    expect(retryAfter - Date.now()).toBeGreaterThan(590_000);
    storage.updateFeedFetchState(feed.id, { ...storage.getFeed(feed.id)!, lastFetchedAt: "2020-01-01T00:00:00Z", errorCount: 0, status: "ok", retryAfter: new Date(retryAfter).toISOString() });
    await poller.tick();
    expect(state.get("/limited.xml")!.requestCount).toBe(1);
  });

  it("never shortens the interval below the publisher's ttl or max-age", async () => {
    state.set("/ttl.xml", { xml: RSS.replace("<title>Fixture Blog</title>", "<title>Fixture Blog</title><ttl>600</ttl>"), requestCount: 0 });
    state.set("/cached.xml", { xml: RSS, headers: { "cache-control": "max-age=7200" }, requestCount: 0 });
    const poller = new Poller(storage);
    const ttl = subscribe(`${baseUrl}/ttl.xml`).feed;
    const cached = subscribe(`${baseUrl}/cached.xml`).feed;
    await poller.refreshFeed(ttl.id);
    await poller.refreshFeed(cached.id);
    expect(storage.getFeed(ttl.id)!.fetchIntervalMin).toBe(600);
    expect(storage.getFeed(cached.id)!.fetchIntervalMin).toBe(120);
  });

  it("backfills paged history as read, stopping at loops and the page cap", async () => {
    const page = (title: string, guid: string, next: string | null) => `<?xml version="1.0"?>
      <rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>Paged</title><link>https://paged.example/</link>
      ${next ? `<atom:link rel="next" href="${next}"/>` : ""}
      <item><title>${title}</title><guid>${guid}</guid></item></channel></rss>`;
    state.set("/paged.xml", { xml: page("Newest", "n1", "/paged.xml?page=2"), requestCount: 0 });
    state.set("/paged.xml?page=2", { xml: page("Older", "o2", "/paged.xml?page=3"), requestCount: 0 });
    state.set("/paged.xml?page=3", { xml: page("Oldest", "o3", "/paged.xml"), requestCount: 0 });
    const { user, feed } = subscribe(`${baseUrl}/paged.xml`);
    const poller = new Poller(storage);
    const first = await poller.refreshFeed(feed.id);
    expect(first.olderUrl).toBe(`${baseUrl}/paged.xml?page=2`);

    const result = await poller.backfillFeed(feed.id, first.olderUrl!);
    expect(result).toEqual({ pages: 2, newArticles: 2 });
    const articles = storage.listArticles({ userId: user.id, limit: 10 });
    expect(articles.map((a) => a.title).sort()).toEqual(["Newest", "Older", "Oldest"]);
    expect(articles.filter((a) => a.readAt === null).map((a) => a.title)).toEqual(["Newest"]);
    expect(state.get("/paged.xml")!.requestCount).toBe(1); // the loop back to the feed was not followed

    const capped = await poller.backfillFeed(feed.id, first.olderUrl!, 1);
    expect(capped).toEqual({ pages: 1, newArticles: 0 });
  });

  it("refreshes only due feeds", async () => {
    const { feed } = subscribe(`${baseUrl}/feed.xml`);
    const poller = new Poller(storage);
    await poller.tick();
    expect(state.get("/feed.xml")!.requestCount).toBe(1);
    await poller.tick(); // not due anymore
    expect(state.get("/feed.xml")!.requestCount).toBe(1);
    expect(storage.getFeed(feed.id)!.errorCount).toBe(0);
  });

  it("skips feeds within the error backoff window even when due by interval", async () => {
    const { feed } = subscribe(`${baseUrl}/broken.xml`);
    const poller = new Poller(storage);
    await poller.refreshFeed(feed.id);
    expect(storage.getFeed(feed.id)!.errorCount).toBe(1);
    const before = state.get("/broken.xml")!.requestCount;
    storage.updateFeedFetchState(feed.id, {
      lastFetchedAt: new Date(Date.now() - 70 * 60_000).toISOString(),
      fetchIntervalMin: 60,
      errorCount: 10,
      status: "ok",
    });
    await poller.tick(); // due (70 > 60) but backoff is 2^10 = 1024 min
    expect(state.get("/broken.xml")!.requestCount).toBe(before);
  });
});
