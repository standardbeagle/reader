import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createSqliteStorage } from "../src/storage/sqlite.js";
import { IngestorEngine } from "../src/ingestors/engine.js";
import type { Storage } from "../src/storage/types.js";
import type { LlmClient } from "../src/llm/client.js";

let storage: Storage;
let userId: string;

const fakeLlm: LlmClient = {
  async filterBatch(items) {
    return items.map((i) => ({ id: i.id, score: i.text.includes("bait") ? 1 : 9, reason: "test" }));
  },
  async summarizeBatch(items) {
    return items.map((i) => ({ id: i.id, title: `Clean: ${i.title ?? "post"}`, summary: "Factual summary." }));
  },
};

const failingLlm: LlmClient = {
  async filterBatch() { throw new Error("llm down"); },
  async summarizeBatch() { throw new Error("llm down"); },
};

function makeFlakyLlm() {
  const state = { fail: true };
  const llm: LlmClient = {
    async filterBatch(items) {
      if (state.fail) throw new Error("llm down");
      return items.map((i) => ({ id: i.id, score: 9, reason: "ok" }));
    },
    async summarizeBatch(items) {
      if (state.fail) throw new Error("llm down");
      return items.map((i) => ({ id: i.id, title: `Clean: ${i.title ?? "post"}`, summary: "Factual summary." }));
    },
  };
  return { state, llm };
}

beforeEach(() => {
  storage = createSqliteStorage(":memory:");
  userId = storage.getOrCreateLocalUser().id;
});
afterEach(() => storage.close());

function makeIngestor(engine: IngestorEngine, kind = "test", opts: Parameters<Storage["updateIngestor"]>[1] = {}) {
  const feed = storage.createFeed(userId, { url: `ingestor://${kind}/${Math.random()}`, title: kind, siteUrl: null });
  const ing = storage.createIngestor(userId, { kind: "reddit", config: { _kind: kind }, feedId: feed.id });
  if (Object.keys(opts).length) storage.updateIngestor(ing.id, opts);
  return storage.getIngestor(ing.id)!;
}

const item = (n: number, text = `good content ${n}`) => ({
  externalId: `e${n}`, author: "a", title: `post ${n}`, text, url: `https://x/${n}`,
  publishedAt: new Date("2026-07-01").toISOString(),
});

describe("IngestorEngine", () => {
  it("realtime: fetch, filter, summarize, deliver as articles", async () => {
    const engine = new IngestorEngine(storage, fakeLlm, {
      test: async () => ({ items: [item(1), item(2, "clickbait garbage bait"), item(3)], cursor: {} }),
    });
    const ing = makeIngestor(engine);
    const result = await engine.processIngestor(ing.id);
    expect(result).toMatchObject({ fetched: 3, kept: 2, dropped: 1 });
    const articles = storage.listArticles({ userId, feedId: ing.feedId, limit: 50 });
    expect(articles).toHaveLength(2);
    expect(articles[0]!.title).toMatch(/^Clean:/);
    expect(articles[0]!.contentHtml).toContain("Factual summary");
    expect(articles[0]!.contentHtml).toContain("https://x/");
  });

  it("streamed items share staging and dedupe with polling, and never run the pipeline twice at once", async () => {
    let filterCalls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const slowLlm: LlmClient = {
      async filterBatch(items) { filterCalls++; await gate; return items.map((i) => ({ id: i.id, score: 9, reason: "ok" })); },
      async summarizeBatch(items) { return items.map((i) => ({ id: i.id, title: `Clean: ${i.title}`, summary: "S." })); },
    };
    const engine = new IngestorEngine(storage, slowLlm, { test: async () => ({ items: [item(1), item(2)], cursor: {} }) });
    const ing = makeIngestor(engine);
    const polled = engine.processIngestor(ing.id);
    const streamed = engine.ingestStreamed(ing.id, [item(2), item(3)]);
    await new Promise((r) => setTimeout(r, 20));
    expect(filterCalls).toBe(1); // the stream batch waits for the poll's pipeline
    release();
    expect(await polled).toMatchObject({ fetched: 2, kept: 2 });
    expect(await streamed).toEqual({ staged: 1, kept: 1, dropped: 0 });
    expect(storage.listArticles({ userId, feedId: ing.feedId, limit: 50 }).map((a) => a.title).sort())
      .toEqual(["Clean: post 1", "Clean: post 2", "Clean: post 3"]);
  });

  it("dedupes across runs", async () => {
    const engine = new IngestorEngine(storage, fakeLlm, {
      test: async () => ({ items: [item(1), item(2)], cursor: {} }),
    });
    const ing = makeIngestor(engine);
    await engine.processIngestor(ing.id);
    const second = await engine.processIngestor(ing.id);
    expect(second).toMatchObject({ fetched: 2, kept: 0, dropped: 0 });
    expect(storage.listArticles({ userId, feedId: ing.feedId, limit: 50 })).toHaveLength(2);
  });

  it("digest: stages without delivering until flush", async () => {
    const engine = new IngestorEngine(storage, fakeLlm, {
      test: async () => ({ items: [item(1), item(2)], cursor: {} }),
    });
    const ing = makeIngestor(engine, "test", { digestMode: "hourly" });
    await engine.processIngestor(ing.id);
    expect(storage.listArticles({ userId, feedId: ing.feedId, limit: 50 })).toHaveLength(0);
    expect(storage.pendingItems(ing.id)).toHaveLength(2);
    const flush = await engine.flushDigest(ing.id);
    expect(flush).toMatchObject({ kept: 2 });
    const articles = storage.listArticles({ userId, feedId: ing.feedId, limit: 50 });
    expect(articles).toHaveLength(2);
    expect(storage.pendingItems(ing.id)).toHaveLength(0);
    const now = Date.now();
    for (const a of articles) {
      expect(a.publishedAt).toBeTruthy();
      expect(Math.abs(now - new Date(a.publishedAt!).getTime())).toBeLessThan(10_000);
    }
  });

  it("realtime: retries staged items after transient llm failure", async () => {
    const { state, llm } = makeFlakyLlm();
    let fetchCount = 0;
    const engine = new IngestorEngine(storage, llm, {
      test: async () => {
        fetchCount++;
        return { items: fetchCount === 1 ? [item(1)] : [], cursor: {} };
      },
    });
    const ing = makeIngestor(engine);
    const first = await engine.processIngestor(ing.id);
    expect(first).toHaveProperty("error");
    expect(storage.listArticles({ userId, feedId: ing.feedId, limit: 50 })).toHaveLength(0);
    expect(storage.pendingItems(ing.id)).toHaveLength(1);
    state.fail = false;
    const second = await engine.processIngestor(ing.id);
    expect(second).toMatchObject({ fetched: 0, kept: 1, dropped: 0 });
    expect(storage.listArticles({ userId, feedId: ing.feedId, limit: 50 })).toHaveLength(1);
    expect(storage.pendingItems(ing.id)).toHaveLength(0);
  });

  it("llm failure: items stay staged, error recorded, no articles", async () => {
    const engine = new IngestorEngine(storage, failingLlm, {
      test: async () => ({ items: [item(1)], cursor: {} }),
    });
    const ing = makeIngestor(engine);
    const result = await engine.processIngestor(ing.id);
    expect(result).toHaveProperty("error");
    expect(storage.listArticles({ userId, feedId: ing.feedId, limit: 50 })).toHaveLength(0);
    expect(storage.getIngestor(ing.id)!.errorCount).toBe(1);
  });

  it("llm disabled: raw passthrough without llm calls", async () => {
    const engine = new IngestorEngine(storage, failingLlm, {
      test: async () => ({ items: [item(1, "anything bait whatever")], cursor: {} }),
    });
    const ing = makeIngestor(engine, "test", { llmEnabled: false });
    const result = await engine.processIngestor(ing.id);
    expect(result).toMatchObject({ kept: 1 });
    const articles = storage.listArticles({ userId, feedId: ing.feedId, limit: 50 });
    expect(articles[0]!.title).toBe("post 1");
  });

  it("tick processes due ingestors and due digest flushes", async () => {
    const engine = new IngestorEngine(storage, fakeLlm, {
      test: async () => ({ items: [item(1)], cursor: {} }),
    });
    const ing = makeIngestor(engine);
    await engine.tick();
    expect(storage.listArticles({ userId, feedId: ing.feedId, limit: 50 })).toHaveLength(1);
    await engine.tick(); // not due anymore
    expect(storage.listArticles({ userId, feedId: ing.feedId, limit: 50 })).toHaveLength(1);
  });
});
