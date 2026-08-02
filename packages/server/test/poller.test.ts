import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Server } from "node:http";
import { createSqliteStorage } from "../src/storage/sqlite.js";
import { Poller } from "../src/poller/poller.js";
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
let state: Map<string, { xml: string; etag?: string; statusOnRequest?: number; requestCount: number }>;

beforeEach(async () => {
  storage = createSqliteStorage(":memory:");
  ({ server, baseUrl, state } = await startFixtureServer({
    "/feed.xml": { xml: RSS, etag: '"v1"' },
    "/broken.xml": { xml: "", statusOnRequest: 500 },
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
});

describe("Poller.tick", () => {
  it("refreshes only due feeds", async () => {
    const { feed } = subscribe(`${baseUrl}/feed.xml`);
    const poller = new Poller(storage);
    await poller.tick();
    expect(state.get("/feed.xml")!.requestCount).toBe(1);
    await poller.tick(); // not due anymore
    expect(state.get("/feed.xml")!.requestCount).toBe(1);
    expect(storage.getFeed(feed.id)!.errorCount).toBe(0);
  });
});
