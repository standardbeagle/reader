import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createServer } from "../src/api/server.js";
import type { LlmClient } from "../src/llm/client.js";
import type { NormalizedItem } from "../src/storage/types.js";

const fakeLlm: LlmClient = {
  async filterBatch(items) {
    return items.map((i) => ({ id: i.id, score: i.text.includes("bait") ? 1 : 9, reason: "test" }));
  },
  async summarizeBatch(items) {
    return items.map((i) => ({ id: i.id, title: `Clean: ${i.title ?? "post"}`, summary: "Factual summary." }));
  },
};

const fakeFetch = async (): Promise<{ items: NormalizedItem[]; cursor: Record<string, unknown> }> => ({
  items: [
    { externalId: "t3_1", author: "alice", title: "Deep dive into sqlite", text: "A substantive post about sqlite internals", url: "https://example.com/1", publishedAt: "2026-08-01T00:00:00Z" },
    { externalId: "t3_2", author: "bob", title: "you wont believe this", text: "total engagement bait nonsense", url: "https://example.com/2", publishedAt: "2026-08-01T01:00:00Z" },
  ],
  cursor: { after: "t3_2" },
});

let app: FastifyInstance;

beforeEach(async () => {
  app = await createServer({
    dbPath: ":memory:",
    poller: false,
    ingestorAdapters: { test: fakeFetch },
    llm: fakeLlm,
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("ingestor api", () => {
  it("creates an ingestor with a backing feed", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/ingestors",
      payload: { kind: "reddit", config: { subreddit: "test", _kind: "test" }, fetchIntervalMin: 30 },
    });
    expect(res.statusCode).toBe(201);
    const ing = res.json();
    expect(ing.kind).toBe("reddit");
    expect(ing.fetchIntervalMin).toBe(30);
    expect(ing.feedId).toBeTruthy();

    const feeds = await app.inject({ method: "GET", url: "/api/v1/feeds" });
    const feed = feeds.json().feeds.find((f: { id: string }) => f.id === ing.feedId);
    expect(feed.url).toBe("ingestor://reddit/r/test");
    expect(feed.title).toBe("r/test");
  });

  it("rejects a bogus kind with 400", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/ingestors",
      payload: { kind: "bogus", config: {} },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("invalid_ingestor");
  });

  it("rejects llmEnabled when the server has no llm configured", async () => {
    const noLlmApp = await createServer({
      dbPath: ":memory:",
      poller: false,
      ingestorAdapters: { test: fakeFetch },
      llm: null,
    });
    await noLlmApp.ready();
    try {
      const res = await noLlmApp.inject({
        method: "POST", url: "/api/v1/ingestors",
        payload: { kind: "reddit", config: { subreddit: "test", _kind: "test" }, llmEnabled: true },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("llm_not_configured");
    } finally {
      await noLlmApp.close();
    }
  });

  it("lists ingestors with feedTitle", async () => {
    await app.inject({
      method: "POST", url: "/api/v1/ingestors",
      payload: { kind: "reddit", config: { subreddit: "test", _kind: "test" } },
    });
    const res = await app.inject({ method: "GET", url: "/api/v1/ingestors" });
    expect(res.statusCode).toBe(200);
    const list = res.json().ingestors;
    expect(list).toHaveLength(1);
    expect(list[0].kind).toBe("reddit");
    expect(list[0].feedTitle).toBe("r/test");
  });

  it("patches pace fields", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/v1/ingestors",
      payload: { kind: "reddit", config: { subreddit: "test", _kind: "test" } },
    });
    const id = created.json().id;
    const res = await app.inject({
      method: "PATCH", url: `/api/v1/ingestors/${id}`,
      payload: { filterThreshold: 8, digestMode: "hourly" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().filterThreshold).toBe(8);
    expect(res.json().digestMode).toBe("hourly");
  });

  it("deletes an ingestor and cascades to its feed", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/v1/ingestors",
      payload: { kind: "reddit", config: { subreddit: "test", _kind: "test" } },
    });
    const ing = created.json();
    const res = await app.inject({ method: "DELETE", url: `/api/v1/ingestors/${ing.id}` });
    expect(res.statusCode).toBe(204);

    const list = await app.inject({ method: "GET", url: "/api/v1/ingestors" });
    expect(list.json().ingestors).toHaveLength(0);
    const feeds = await app.inject({ method: "GET", url: "/api/v1/feeds" });
    expect(feeds.json().feeds.find((f: { id: string }) => f.id === ing.feedId)).toBeUndefined();
  });

  it("test-runs an ingestor config and returns kept/dropped split", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/ingestors/test",
      payload: { kind: "reddit", config: { _kind: "test" }, threshold: 5 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.kept).toHaveLength(1);
    expect(body.kept[0].title).toBe("Clean: Deep dive into sqlite");
    expect(body.kept[0].score).toBe(9);
    expect(body.dropped).toHaveLength(1);
    expect(body.dropped[0].score).toBe(1);
    expect(body.dropped[0].reason).toBe("test");
  });
});
