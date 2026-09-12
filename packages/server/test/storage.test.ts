import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { createSqliteStorage } from "../src/storage/sqlite.js";
import { sanitizeHtml } from "@reader/core";
import type { Storage } from "../src/storage/types.js";

let storage: Storage;
let userId: string;
const identity = (html: string) => html;

beforeEach(() => {
  storage = createSqliteStorage(":memory:");
  userId = storage.getOrCreateLocalUser().id;
});
afterEach(() => storage.close());

function makeFeed(url = "https://a.example.com/feed.xml") {
  return storage.createFeed(userId, { url, title: "A", siteUrl: null });
}

describe("sqlite storage", () => {
  it("creates and retrieves the local user idempotently", () => {
    const a = storage.getOrCreateLocalUser();
    const b = storage.getOrCreateLocalUser();
    expect(a.id).toBe(b.id);
  });

  it("rejects duplicate feed urls for the same user", () => {
    makeFeed();
    expect(() => makeFeed()).toThrow(/UNIQUE/);
  });

  it("upserts articles and dedupes by guid", () => {
    const feed = makeFeed();
    const arts = [
      { guid: "g1", url: null, title: "T1", author: null, publishedAt: null, contentHtml: "<p>x</p>", summary: null, imageUrl: "/cover.jpg" },
      { guid: "g2", url: null, title: "T2", author: null, publishedAt: null, contentHtml: null, summary: "s" },
    ];
    const inserted1 = storage.upsertArticles(feed.id, arts, identity);
    const inserted2 = storage.upsertArticles(feed.id, arts, identity);
    expect(inserted1).toHaveLength(2);
    expect(inserted1[0]!.imageUrl).toBe("https://a.example.com/cover.jpg");
    expect(inserted2).toHaveLength(0);
    expect(storage.listArticles({ userId, limit: 50 })).toHaveLength(2);
  });

  it("falls back to the first content image as hero", () => {
    const feed = makeFeed();
    const arts = [
      { guid: "g3", url: null, title: "T3", author: null, publishedAt: null, contentHtml: "<p>before</p><img src=\"/img/pic.jpg\"><p>after</p>", summary: null, imageUrl: null },
      { guid: "g4", url: "https://b.example.com/post", title: "T4", author: null, publishedAt: null, contentHtml: "<img src=\"/relative.png\">", summary: null, imageUrl: null },
      { guid: "g5", url: null, title: "T5", author: null, publishedAt: null, contentHtml: "<p>no images</p>", summary: null, imageUrl: null },
    ];
    const inserted = storage.upsertArticles(feed.id, arts, identity);
    expect(inserted[0]!.imageUrl).toBe("https://a.example.com/img/pic.jpg");
    // relative src resolves against the article url, not the feed url
    expect(inserted[1]!.imageUrl).toBe("https://b.example.com/relative.png");
    expect(inserted[2]!.imageUrl).toBeNull();
  });

  it("stores feed categories and filters the list by them", () => {
    const feed = makeFeed();
    storage.upsertArticles(feed.id, [
      { guid: "c1", url: null, title: "News", author: null, publishedAt: null, contentHtml: null, summary: "s", categories: ["World", "Politics"] },
      { guid: "c2", url: null, title: "Tech", author: null, publishedAt: null, contentHtml: null, summary: "s", categories: ["Tech"] },
      { guid: "c3", url: null, title: "Untagged", author: null, publishedAt: null, contentHtml: null, summary: "s" },
    ], identity);
    const listed = storage.listArticles({ userId, limit: 50 });
    expect(listed.find((a) => a.guid === "c1")?.categories).toEqual(["World", "Politics"]);
    expect(listed.find((a) => a.guid === "c3")?.categories).toEqual([]);
    expect(storage.listArticles({ userId, limit: 50, category: "World" }).map((a) => a.guid)).toEqual(["c1"]);
    expect(storage.listArticles({ userId, limit: 50, category: "Tech" }).map((a) => a.guid)).toEqual(["c2"]);
    expect(storage.listArticles({ userId, limit: 50, category: "Missing" })).toHaveLength(0);
  });

  it("lists category counts scoped to a feed", () => {
    const feedA = makeFeed("https://a.example.com/a.xml");
    const feedB = makeFeed("https://b.example.com/b.xml");
    storage.upsertArticles(feedA.id, [
      { guid: "a1", url: null, title: "A1", author: null, publishedAt: null, contentHtml: null, summary: "s", categories: ["World", "Politics"] },
      { guid: "a2", url: null, title: "A2", author: null, publishedAt: null, contentHtml: null, summary: "s", categories: ["World"] },
    ], identity);
    storage.upsertArticles(feedB.id, [
      { guid: "b1", url: null, title: "B1", author: null, publishedAt: null, contentHtml: null, summary: "s", categories: ["Tech"] },
    ], identity);
    expect(storage.listCategories(userId)).toEqual([
      { name: "World", count: 2 }, { name: "Politics", count: 1 }, { name: "Tech", count: 1 },
    ]);
    expect(storage.listCategories(userId, feedA.id)).toEqual([
      { name: "World", count: 2 }, { name: "Politics", count: 1 },
    ]);
  });

  it("pages by (published_at, id) without skipping same-timestamp articles", () => {
    const feed = makeFeed();
    const at = (iso: string) => new Date(iso);
    const arts = [
      { guid: "p1", url: null, title: "P1", author: null, publishedAt: at("2026-07-01T10:00:00Z"), contentHtml: null, summary: "s" },
      { guid: "p2", url: null, title: "P2", author: null, publishedAt: at("2026-07-01T10:00:00Z"), contentHtml: null, summary: "s" },
      { guid: "p3", url: null, title: "P3", author: null, publishedAt: at("2026-07-01T10:00:00Z"), contentHtml: null, summary: "s" },
      { guid: "p4", url: null, title: "P4", author: null, publishedAt: at("2026-06-30T09:00:00Z"), contentHtml: null, summary: "s" },
    ];
    storage.upsertArticles(feed.id, arts, identity);
    const page1 = storage.listArticles({ userId, limit: 2 });
    expect(page1.map((a) => a.guid)).toHaveLength(2);
    const cursor = page1[page1.length - 1]!;
    const page2 = storage.listArticles({
      userId, limit: 2,
      before: cursor.publishedAt!, beforeId: cursor.id,
    });
    const seen = [...page1, ...page2].map((a) => a.guid);
    expect(new Set(seen).size).toBe(4);
    expect(seen).toContain("p4");
  });

  it("promotes markup summaries and formats plain feed bodies", () => {
    const feed = makeFeed();
    storage.upsertArticles(feed.id, [
      { guid: "html-summary", url: "https://a.example.com/quote", title: "Quote", author: null, publishedAt: null, contentHtml: null, summary: "<blockquote><p>Quoted</p></blockquote>" },
      { guid: "plain", url: null, title: "Plain", author: null, publishedAt: null, contentHtml: "One line\n\nSecond line", summary: null },
    ], identity);
    const listed = storage.listArticles({ userId, limit: 50 });
    const quote = listed.find((a) => a.guid === "html-summary");
    const plain = listed.find((a) => a.guid === "plain");
    expect(quote?.contentHtml).toContain("<blockquote>");
    expect(quote?.summary).toBeNull();
    expect(plain?.contentHtml).toContain('class="feed-plain-text"');
    expect(plain?.contentHtml).toContain("Second line");

    const compact = storage.listArticles({ userId, limit: 50, includeContent: false });
    expect(compact.find((a) => a.guid === "html-summary")?.contentHtml).toBeNull();
    expect(compact.find((a) => a.guid === "plain")?.summary).toBeNull();
  });

  it("tracks read state per user", () => {
    const feed = makeFeed();
    const [a] = storage.upsertArticles(feed.id, [
      { guid: "g1", url: null, title: "T1", author: null, publishedAt: null, contentHtml: null, summary: null },
    ], identity);
    expect(storage.unreadCounts(userId)[feed.id]).toBe(1);
    storage.setRead(userId, a!.id, true);
    expect(storage.unreadCounts(userId)[feed.id]).toBeUndefined();
    const listed = storage.listArticles({ userId, limit: 50 });
    expect(listed[0]!.readAt).not.toBeNull();
    storage.setRead(userId, a!.id, false);
    expect(storage.unreadCounts(userId)[feed.id]).toBe(1);
  });

  it("filters unreadOnly and by feed, orders newest first", () => {
    const f1 = makeFeed("https://1.example.com/f");
    const f2 = makeFeed("https://2.example.com/f");
    storage.upsertArticles(f1.id, [
      { guid: "old", url: null, title: "Old", author: null, publishedAt: new Date("2026-01-01"), contentHtml: null, summary: null },
      { guid: "new", url: null, title: "New", author: null, publishedAt: new Date("2026-07-01"), contentHtml: null, summary: null },
    ], identity);
    storage.upsertArticles(f2.id, [
      { guid: "other", url: null, title: "Other", author: null, publishedAt: new Date("2026-06-01"), contentHtml: null, summary: null },
    ], identity);
    const all = storage.listArticles({ userId, limit: 50 });
    expect(all.map((a) => a.title)).toEqual(["New", "Other", "Old"]);
    expect(storage.listArticles({ userId, feedId: f2.id, limit: 50 })).toHaveLength(1);
    const [first] = storage.listArticles({ userId, limit: 1 });
    storage.setRead(userId, first!.id, true);
    const unread = storage.listArticles({ userId, unreadOnly: true, limit: 50 });
    expect(unread.map((a) => a.title)).toEqual(["Other", "Old"]);
  });

  it("paginates with before cursor without duplicates or null-published leakage", () => {
    const feed = makeFeed();
    storage.upsertArticles(feed.id, [
      { guid: "n1", url: null, title: "N1", author: null, publishedAt: new Date("2026-07-01"), contentHtml: null, summary: null },
      { guid: "n2", url: null, title: "N2", author: null, publishedAt: new Date("2026-06-01"), contentHtml: null, summary: null },
      { guid: "old", url: null, title: "Old", author: null, publishedAt: new Date("2026-01-01"), contentHtml: null, summary: null },
      { guid: "nopub", url: null, title: "NoPub", author: null, publishedAt: null, contentHtml: null, summary: null },
    ], identity);
    const page1 = storage.listArticles({ userId, limit: 2 });
    expect(page1.map((a) => a.guid)).toEqual(["n1", "n2"]);
    const cursor = page1[page1.length - 1]!.publishedAt!;
    const page2 = storage.listArticles({ userId, before: cursor, limit: 2 });
    const seen = new Set<string>();
    for (const a of [...page1, ...page2]) {
      expect(seen.has(a.id)).toBe(false);
      seen.add(a.id);
    }
    for (const a of page2) {
      expect(a.publishedAt).not.toBeNull();
      expect(a.publishedAt! < cursor).toBe(true);
    }
  });

  it("dueFeeds respects interval and schedules broken feeds for recovery", () => {
    const feed = makeFeed();
    const past = new Date(Date.now() - 2 * 3600_000);
    storage.updateFeedFetchState(feed.id, {
      lastFetchedAt: past.toISOString(), fetchIntervalMin: 60, errorCount: 0, status: "ok",
    });
    expect(storage.dueFeeds(new Date()).map((f) => f.id)).toContain(feed.id);
    storage.updateFeedFetchState(feed.id, {
      lastFetchedAt: new Date().toISOString(), fetchIntervalMin: 60, errorCount: 0, status: "ok",
    });
    expect(storage.dueFeeds(new Date()).map((f) => f.id)).not.toContain(feed.id);
    storage.updateFeedFetchState(feed.id, {
      lastFetchedAt: past.toISOString(), fetchIntervalMin: 60, errorCount: 10, status: "broken",
    });
    expect(storage.dueFeeds(new Date()).map((f) => f.id)).toContain(feed.id);
    storage.updateFeedFetchState(feed.id, {
      lastFetchedAt: new Date().toISOString(), fetchIntervalMin: 60, errorCount: 10, status: "broken",
    });
    expect(storage.dueFeeds(new Date()).map((f) => f.id)).not.toContain(feed.id);
  });

  it("does not send ingestor-backed feeds through the RSS poller", () => {
    const feed = storage.createFeed(userId, { url: "ingestor://mastodon/example", title: "Mastodon", siteUrl: null });
    const past = new Date(Date.now() - 2 * 3600_000);
    storage.updateFeedFetchState(feed.id, {
      lastFetchedAt: past.toISOString(), fetchIntervalMin: 60, errorCount: 0, status: "ok",
    });
    expect(storage.dueFeeds(new Date()).map((f) => f.id)).not.toContain(feed.id);
  });

  it("markAllRead marks every article in a feed", () => {
    const feed = makeFeed();
    storage.upsertArticles(feed.id, [
      { guid: "a", url: null, title: "A", author: null, publishedAt: null, contentHtml: null, summary: null },
      { guid: "b", url: null, title: "B", author: null, publishedAt: null, contentHtml: null, summary: null },
    ], identity);
    storage.markAllRead(userId, feed.id);
    expect(storage.unreadCounts(userId)[feed.id]).toBeUndefined();
  });

  it("reopens an existing database without re-running migrations", () => {
    const dir = mkdtempSync(join(tmpdir(), "reader-storage-"));
    const dbPath = join(dir, "test.db");
    try {
      const first = createSqliteStorage(dbPath);
      const uid = first.getOrCreateLocalUser().id;
      const feed = first.createFeed(uid, { url: "https://re.example.com/feed.xml", title: "Re", siteUrl: null });
      first.close();

      const second = createSqliteStorage(dbPath);
      const feeds = second.listFeeds(uid);
      second.close();
      expect(feeds.map((f) => f.id)).toEqual([feed.id]);

      const raw = new Database(dbPath);
      const { n } = raw.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as { n: number };
      raw.close();
      const migrationsDir = join(import.meta.dirname, "../src/storage/migrations");
      const migrationCount = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).length;
      expect(n).toBe(migrationCount);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("deleteFeed cascades articles", () => {
    const feed = makeFeed();
    storage.upsertArticles(feed.id, [
      { guid: "a", url: null, title: "A", author: null, publishedAt: null, contentHtml: null, summary: null },
    ], identity);
    storage.deleteFeed(feed.id);
    expect(storage.listArticles({ userId, limit: 50 })).toHaveLength(0);
  });

  it("merges the copies a rewritten date and title left behind", () => {
    const dir = mkdtempSync(join(tmpdir(), "reader-guid-"));
    const dbPath = join(dir, "reader.db");
    const url = "https://sci.example/halted-dam-releases";
    try {
      const before = createSqliteStorage(dbPath);
      const uid = before.getOrCreateLocalUser().id;
      const feed = before.createFeed(uid, { url: "https://sci.example/rss", title: "Sci", siteUrl: null });
      const list = before.createList(uid, { title: "Keep", visibility: "private" });
      before.close();

      // Re-stage the pre-0012 world: three rows for one article, each hashed
      // under a date and a title the publisher went on to edit.
      const raw = new Database(dbPath);
      const insert = raw.prepare(`INSERT INTO articles (id, feed_id, guid, url, title, published_at, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`);
      insert.run("art-first", feed.id, "sha1:aaa", url,
        "Halted dam releases threaten Colorado river ecosystems", "2026-08-11T04:30:00.000Z", "2026-08-11T05:00:00.000Z");
      insert.run("art-restamped", feed.id, "sha1:bbb", url,
        "Halted dam releases threaten Colorado river ecosystems", "2026-08-11T04:30:58.000Z", "2026-08-11T06:00:00.000Z");
      insert.run("art-retitled", feed.id, "sha1:ccc", url,
        "Halted dam releases threaten Colorado River ecosystems", "2026-08-11T04:30:58.000Z", "2026-08-12T06:00:00.000Z");
      raw.prepare("INSERT INTO user_articles (user_id, article_id, read_at) VALUES (?, 'art-retitled', ?)")
        .run(uid, "2026-08-12T12:00:00.000Z");
      raw.prepare("INSERT INTO user_articles (user_id, article_id, snoozed_until) VALUES (?, 'art-restamped', ?)")
        .run(uid, "2026-08-20T00:00:00.000Z");
      raw.prepare("INSERT INTO list_items (list_id, article_id, added_at) VALUES (?, 'art-retitled', ?)")
        .run(list.id, "2026-08-12T12:00:00.000Z");
      raw.prepare("DELETE FROM schema_migrations WHERE name = ?").run("0012_link_is_the_synthesized_guid.sql");
      raw.close();

      const after = createSqliteStorage(dbPath);
      const articles = after.listArticles({ userId: uid, limit: 50, includeSnoozed: true });
      const listed = after.listArticles({ userId: uid, listId: list.id, limit: 50, includeSnoozed: true });
      after.close();

      expect(articles).toHaveLength(1);
      const survivor = articles[0]!;
      // The copy that arrived first survives, carrying the state that landed
      // on the later ones, and answers to the link the parser now uses.
      expect(survivor.id).toBe("art-first");
      expect(survivor.guid).toBe(url);
      expect(survivor.readAt).toBe("2026-08-12T12:00:00.000Z");
      expect(survivor.snoozedUntil).toBe("2026-08-20T00:00:00.000Z");
      expect(listed.map((a) => a.id)).toEqual(["art-first"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("decodes entities in titles stored before the parser decoded them", () => {
    const legacy = createSqliteStorage(":memory:");
    const uid = legacy.getOrCreateLocalUser().id;
    const feed = legacy.createFeed(uid, { url: "https://t.example/feed", title: "T", siteUrl: null });
    legacy.upsertArticles(feed.id, [{ guid: "g", url: null, title: "Samsung says &#8216;Tim Cook&#8217; bought one", author: null, publishedAt: null, contentHtml: null, summary: null }], sanitizeHtml);
    expect(legacy.listArticles({ userId: uid, limit: 5 })[0]!.title).toBe("Samsung says ‘Tim Cook’ bought one");
    legacy.close();
  });
});
