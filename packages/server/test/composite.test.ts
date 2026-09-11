import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createSqliteStorage } from "../src/storage/sqlite.js";
import { IngestorEngine } from "../src/ingestors/engine.js";
import { compositeAdapter } from "../src/ingestors/composite.js";
import { adapters } from "../src/ingestors/index.js";
import { sanitizeHtml } from "@reader/core";
import type { Storage } from "../src/storage/types.js";
import type { LlmClient } from "../src/llm/client.js";

let storage: Storage;
let userId: string;

const identity = (html: string) => html;

const fakeLlm: LlmClient = {
  async filterBatch(items) {
    return items.map((i) => ({ id: i.id, score: i.text.includes("bait") ? 1 : 9, reason: "test" }));
  },
  async summarizeBatch(items) {
    return items.map((i) => ({ id: i.id, title: `Clean: ${i.title ?? "post"}`, summary: "Factual summary." }));
  },
};

beforeEach(() => {
  storage = createSqliteStorage(":memory:");
  userId = storage.getOrCreateLocalUser().id;
});
afterEach(() => storage.close());

function seedFeed(url: string, title: string, articles: { guid: string; title: string; url: string; author: string | null; publishedAt: Date; contentHtml: string; summary: string | null }[]) {
  const feed = storage.createFeed(userId, { url, title, siteUrl: null });
  storage.upsertArticles(feed.id, articles, sanitizeHtml);
  return feed;
}

function makeComposite(feedIds: string[], name: string) {
  const feed = storage.createFeed(userId, { url: `ingestor://composite/${name}`, title: name, siteUrl: null });
  const ing = storage.createIngestor(userId, { kind: "composite", config: { name, sourceFeedIds: feedIds }, feedId: feed.id });
  return storage.getIngestor(ing.id)!;
}

describe("compositeAdapter", () => {
  it("rejects empty source list on validate", async () => {
    await expect(compositeAdapter.validate({}, { storage, userId })).rejects.toThrow(/sourceFeedIds/);
    await expect(compositeAdapter.validate({ sourceFeedIds: ["f1"] }, { storage, userId })).resolves.toBe("Combined feeds");
    await expect(compositeAdapter.validate({ sourceFeedIds: ["f1"], name: "Tech" }, { storage, userId })).resolves.toBe("Tech");
  });

  it("is registered for the composite kind", () => {
    expect(adapters.composite).toBe(compositeAdapter);
  });

  it("pulls articles from source feeds and strips html", async () => {
    const a = seedFeed("https://a.example/feed.xml", "A", [
      { guid: "g1", title: "Post A", url: "https://a.example/1", author: null, summary: null, publishedAt: new Date("2026-07-01T10:00:00Z"), contentHtml: "<p>Hello <b>world</b></p>" },
    ]);
    const b = seedFeed("https://b.example/feed.xml", "B", [
      { guid: "g2", title: "Post B", url: "https://b.example/1", author: null, summary: null, publishedAt: new Date("2026-07-01T11:00:00Z"), contentHtml: "<p>Clickbait bait</p>" },
    ]);
    const ctx = { storage, userId };
    const res = await compositeAdapter.fetch({ sourceFeedIds: [a.id, b.id] }, null, ctx);
    expect(res.items).toHaveLength(2);
    expect(res.items.map((i) => i.text)).toEqual(["Hello world", "Clickbait bait"]);
    expect(res.cursor.since).toBe("2026-07-01T11:00:00.000Z");
  });

  it("cursor suppresses already-seen articles", async () => {
    const a = seedFeed("https://a.example/feed.xml", "A", [
      { guid: "g1", title: "Old", url: "https://a.example/1", author: null, summary: null, publishedAt: new Date("2026-07-01T10:00:00Z"), contentHtml: "<p>old</p>" },
      { guid: "g2", title: "New", url: "https://a.example/2", author: null, summary: null, publishedAt: new Date("2026-07-02T10:00:00Z"), contentHtml: "<p>new</p>" },
    ]);
    const ctx = { storage, userId };
    const first = await compositeAdapter.fetch({ sourceFeedIds: [a.id] }, null, ctx);
    expect(first.items).toHaveLength(2);
    const second = await compositeAdapter.fetch({ sourceFeedIds: [a.id] }, first.cursor, ctx);
    expect(second.items).toHaveLength(1);
    expect(second.items[0]!.title).toBe("New");
  });

  it("throws without storage context", async () => {
    await expect(compositeAdapter.fetch({ sourceFeedIds: ["x"] }, null, undefined as never)).rejects.toThrow();
  });
});

describe("composite ingestor end-to-end", () => {
  it("filters and summarizes source articles into the combined feed", async () => {
    const src1 = seedFeed("https://1.example/feed.xml", "One", [
      { guid: "g1", title: "Good", url: "https://1.example/1", author: null, summary: null, publishedAt: new Date("2026-07-01T10:00:00Z"), contentHtml: "<p>solid reporting</p>" },
    ]);
    const src2 = seedFeed("https://2.example/feed.xml", "Two", [
      { guid: "g2", title: "Bad", url: "https://2.example/1", author: null, summary: null, publishedAt: new Date("2026-07-01T11:00:00Z"), contentHtml: "<p>clickbait bait</p>" },
    ]);
    const engine = new IngestorEngine(storage, fakeLlm);
    const ing = makeComposite([src1.id, src2.id], "Tech brief");
    const result = await engine.processIngestor(ing.id);
    expect(result).toMatchObject({ fetched: 2, kept: 1, dropped: 1 });
    const articles = storage.listArticles({ userId, feedId: ing.feedId, limit: 50 });
    expect(articles).toHaveLength(1);
    expect(articles[0]!.title).toBe("Clean: Good");
  });

  it("only stages new source articles on later runs", async () => {
    const src = seedFeed("https://1.example/feed.xml", "One", [
      { guid: "g1", title: "First", url: "https://1.example/1", author: null, summary: null, publishedAt: new Date("2026-07-01T10:00:00Z"), contentHtml: "<p>one</p>" },
    ]);
    const engine = new IngestorEngine(storage, fakeLlm);
    const ing = makeComposite([src.id], "Brief");
    await engine.processIngestor(ing.id);
    const second = await engine.processIngestor(ing.id);
    // The since-watermark is boundary-inclusive, so the boundary article is
    // refetched; staging dedupes it, so nothing new is delivered.
    expect(second).toMatchObject({ fetched: 1, kept: 0 });
    expect(storage.listArticles({ userId, feedId: ing.feedId, limit: 50 })).toHaveLength(1);
    storage.upsertArticles(src.id, [
      { guid: "g2", title: "Second", url: "https://1.example/2", author: null, summary: null, publishedAt: new Date("2026-07-02T10:00:00Z"), contentHtml: "<p>two</p>" },
    ], sanitizeHtml);
    const third = await engine.processIngestor(ing.id);
    // g1 is refetched at the boundary but deduped at staging; g2 is new.
    expect(third).toMatchObject({ fetched: 2, kept: 1 });
  });
});
