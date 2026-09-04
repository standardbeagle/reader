import { describe, it, expect, beforeEach, afterEach } from "vitest";
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

function seedArticle(feedId: string, guid = "g1") {
  const inserted = storage.upsertArticles(feedId, [
    { guid, url: "https://a.example.com/1", title: "T1", author: null, publishedAt: new Date("2026-07-01T12:00:00Z"), contentHtml: "<p>x</p>", summary: null },
  ], identity);
  return inserted[0]!;
}

describe("snooze", () => {
  it("hides snoozed articles from the list and unread counts until expiry", () => {
    const feed = makeFeed();
    const article = seedArticle(feed.id);
    expect(storage.unreadCounts(userId)[feed.id]).toBe(1);

    const future = new Date(Date.now() + 3_600_000);
    storage.setSnooze(userId, article.id, future);

    expect(storage.listArticles({ userId, limit: 50 })).toHaveLength(0);
    expect(storage.listArticles({ userId, limit: 50, includeSnoozed: true })).toHaveLength(1);
    expect(storage.unreadCounts(userId)[feed.id]).toBeUndefined();
    const fetched = storage.getArticle(userId, article.id);
    expect(fetched?.snoozedUntil).toBe(future.toISOString());
    expect(fetched?.readAt).toBeNull();
  });

  it("returns snoozed articles to the unread list once the snooze expires", () => {
    const feed = makeFeed();
    const article = seedArticle(feed.id);
    storage.setSnooze(userId, article.id, new Date(Date.now() - 1_000));

    const list = storage.listArticles({ userId, limit: 50 });
    expect(list).toHaveLength(1);
    expect(list[0]!.readAt).toBeNull();
    expect(storage.unreadCounts(userId)[feed.id]).toBe(1);
  });

  it("clears the snooze with null and keeps the unread state", () => {
    const feed = makeFeed();
    const article = seedArticle(feed.id);
    storage.setSnooze(userId, article.id, new Date(Date.now() + 3_600_000));
    storage.setSnooze(userId, article.id, null);

    const list = storage.listArticles({ userId, limit: 50 });
    expect(list).toHaveLength(1);
    expect(list[0]!.snoozedUntil).toBeNull();
    expect(list[0]!.readAt).toBeNull();
  });

  it("survives the article being marked read", () => {
    const feed = makeFeed();
    const article = seedArticle(feed.id);
    const future = new Date(Date.now() + 3_600_000);
    storage.setSnooze(userId, article.id, future);
    storage.setRead(userId, article.id, true);
    expect(storage.getArticle(userId, article.id)?.snoozedUntil).toBe(future.toISOString());
  });

  it("marks the article unread when a snooze is set", () => {
    const feed = makeFeed();
    const article = seedArticle(feed.id);
    storage.setRead(userId, article.id, true);
    storage.setSnooze(userId, article.id, new Date(Date.now() + 3_600_000));
    expect(storage.getArticle(userId, article.id)?.readAt).toBeNull();
    // Unsnoozing does not resurrect the read state it cleared.
    storage.setSnooze(userId, article.id, null);
    expect(storage.getArticle(userId, article.id)?.readAt).toBeNull();
  });
});

describe("lists", () => {
  it("creates, lists, and deletes lists with item counts", () => {
    const feed = makeFeed();
    const article = seedArticle(feed.id);
    const list = storage.createList(userId, { title: "Read later", visibility: "private" });
    expect(list.visibility).toBe("private");
    expect(list.token).toBeTruthy();

    storage.addToList(list.id, article.id);
    storage.addToList(list.id, article.id); // idempotent
    const lists = storage.listLists(userId);
    expect(lists).toHaveLength(1);
    expect(lists[0]!.itemCount).toBe(1);

    storage.deleteList(list.id);
    expect(storage.listLists(userId)).toHaveLength(0);
  });

  it("filters articles by list and reports membership on getArticle", () => {
    const feed = makeFeed();
    const a1 = seedArticle(feed.id, "g1");
    seedArticle(feed.id, "g2");
    const list = storage.createList(userId, { title: "Keep", visibility: "public" });
    storage.addToList(list.id, a1.id);

    const inList = storage.listArticles({ userId, limit: 50, listId: list.id });
    expect(inList.map((a) => a.id)).toEqual([a1.id]);
    expect(storage.getArticle(userId, a1.id)?.listIds).toEqual([list.id]);

    storage.removeFromList(list.id, a1.id);
    expect(storage.listArticles({ userId, limit: 50, listId: list.id })).toHaveLength(0);
  });

  it("serves list articles newest-saved first with content, and resolves tokens", () => {
    const feed = makeFeed();
    const a1 = seedArticle(feed.id, "g1");
    const a2 = seedArticle(feed.id, "g2");
    const list = storage.createList(userId, { title: "Public", visibility: "public" });
    storage.addToList(list.id, a1.id);
    storage.addToList(list.id, a2.id);

    const articles = storage.listListArticles(list.id, 100);
    expect(articles.map((a) => a.id)).toEqual([a2.id, a1.id]);
    expect(articles[0]!.contentHtml).toBe("<p>x</p>");

    expect(storage.getListByToken(list.token)?.id).toBe(list.id);
    expect(storage.getListByToken("nope")).toBeNull();
  });

  it("cascades list deletion to its items", () => {
    const feed = makeFeed();
    const article = seedArticle(feed.id);
    const list = storage.createList(userId, { title: "Gone", visibility: "private" });
    storage.addToList(list.id, article.id);
    storage.deleteList(list.id);
    expect(storage.listListArticles(list.id, 100)).toHaveLength(0);
    expect(storage.getArticle(userId, article.id)?.listIds).toEqual([]);
  });
});
