import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { createSqliteStorage } from "../src/storage/sqlite.js";
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
      { guid: "g1", url: null, title: "T1", author: null, publishedAt: null, contentHtml: "<p>x</p>", summary: null },
      { guid: "g2", url: null, title: "T2", author: null, publishedAt: null, contentHtml: null, summary: "s" },
    ];
    const inserted1 = storage.upsertArticles(feed.id, arts, identity);
    const inserted2 = storage.upsertArticles(feed.id, arts, identity);
    expect(inserted1).toHaveLength(2);
    expect(inserted2).toHaveLength(0);
    expect(storage.listArticles({ userId, limit: 50 })).toHaveLength(2);
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

  it("dueFeeds respects interval and skips broken feeds", () => {
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
});
