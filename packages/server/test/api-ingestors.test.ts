import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createServer } from "../src/api/server.js";
import type { LlmClient } from "../src/llm/client.js";
import type { NormalizedItem } from "../src/storage/types.js";
import { startFixtureServer } from "./fixtureServer.js";
import type { Server } from "node:http";

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

  it("derives unique feed keys per mastodon instance and 409s on true duplicates", async () => {
    let fixture: { server: Server; baseUrl: string } | null = null;
    try {
      fixture = await startFixtureServer({
        "/api/v1/instance": { xml: "", rawBody: "{}" },
      });
      const cfg = (instance: string) => ({ instance, tag: "ai", _baseUrl: fixture!.baseUrl });

      const first = await app.inject({
        method: "POST", url: "/api/v1/ingestors",
        payload: { kind: "mastodon", config: cfg("mastodon.social") },
      });
      expect(first.statusCode).toBe(201);

      const second = await app.inject({
        method: "POST", url: "/api/v1/ingestors",
        payload: { kind: "mastodon", config: cfg("hachyderm.io") },
      });
      expect(second.statusCode).toBe(201);

      const feeds = await app.inject({ method: "GET", url: "/api/v1/feeds" });
      const urlOf = (feedId: string) => feeds.json().feeds.find((f: { id: string }) => f.id === feedId)?.url;
      expect(urlOf(first.json().feedId)).toBe("ingestor://mastodon/mastodon.social/tag/ai");
      expect(urlOf(second.json().feedId)).toBe("ingestor://mastodon/hachyderm.io/tag/ai");

      const dup = await app.inject({
        method: "POST", url: "/api/v1/ingestors",
        payload: { kind: "mastodon", config: cfg("mastodon.social") },
      });
      expect(dup.statusCode).toBe(409);
      expect(dup.json().error.code).toBe("duplicate");
    } finally {
      fixture?.server.close();
    }
  });

  it("rejects an invalid digestMode on create with 400", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/ingestors",
      payload: { kind: "reddit", config: { subreddit: "test", _kind: "test" }, digestMode: "weekly" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("invalid_ingestor");
  });

  it("rejects an invalid digestMode on patch with 400", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/v1/ingestors",
      payload: { kind: "reddit", config: { subreddit: "test", _kind: "test" } },
    });
    const res = await app.inject({
      method: "PATCH", url: `/api/v1/ingestors/${created.json().id}`,
      payload: { digestMode: "weekly" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("invalid_ingestor");
  });

  it("redacts credential fields from api responses", async () => {
    const config = { handle: "x", identifier: "me", appPassword: "secretpw", _kind: "test" };
    const created = await app.inject({
      method: "POST", url: "/api/v1/ingestors",
      payload: { kind: "bluesky", config, llmEnabled: false },
    });
    expect(created.statusCode).toBe(201);
    expect(JSON.stringify(created.json())).not.toContain("secretpw");
    expect(created.json().hasCredentials).toBe(true);
    expect(created.json().config.identifier).toBe("me");
    expect(created.json().config.appPassword).toBe("•••");

    const list = await app.inject({ method: "GET", url: "/api/v1/ingestors" });
    expect(list.statusCode).toBe(200);
    expect(JSON.stringify(list.json())).not.toContain("secretpw");
    const item = list.json().ingestors[0];
    expect(item.hasCredentials).toBe(true);
    expect(item.config.identifier).toBe("me");
    expect(item.config.appPassword).toBe("•••");

    const patched = await app.inject({
      method: "PATCH", url: `/api/v1/ingestors/${created.json().id}`,
      payload: { digestMode: "hourly" },
    });
    expect(JSON.stringify(patched.json())).not.toContain("secretpw");
    expect(patched.json().hasCredentials).toBe(true);

    const noCreds = await app.inject({
      method: "POST", url: "/api/v1/ingestors",
      payload: { kind: "reddit", config: { subreddit: "test", _kind: "test" }, llmEnabled: false },
    });
    expect(noCreds.json().hasCredentials).toBe(false);
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

describe("attaching connected accounts", () => {
  it("attaches and detaches a Reddit account, refusing other platforms' accounts", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { createSqliteStorage } = await import("../src/storage/sqlite.js");
    const dir = mkdtempSync(join(tmpdir(), "reader-attach-"));
    const dbPath = join(dir, "reader.db");
    const server = await createServer({ dbPath, poller: false, ingestorAdapters: { test: fakeFetch }, llm: fakeLlm });
    await server.ready();
    const side = createSqliteStorage(dbPath);
    try {
      const uid = side.getOrCreateLocalUser().id;
      const reddit = side.createCredential(uid, {
        provider: "reddit", label: "u/ann", origin: "https://oauth.reddit.com",
        secret: { kind: "oauth2", tokenUrl: "https://www.reddit.com/api/v1/access_token", clientId: "c", clientSecret: "s", accessToken: "a", refreshToken: "r", expiresAt: null },
      });
      const generic = side.createCredential(uid, { provider: "generic", label: "x.example", origin: "https://x.example", secret: { kind: "bearer", token: "t" } });
      const created = await server.inject({ method: "POST", url: "/api/v1/ingestors", payload: { kind: "reddit", config: { subreddit: "test", _kind: "test" }, llmEnabled: false } });
      const id = created.json().id;

      const wrong = await server.inject({ method: "PATCH", url: `/api/v1/ingestors/${id}`, payload: { credentialId: generic.id } });
      expect(wrong.statusCode).toBe(422);
      expect(wrong.json().error.message).toMatch(/generic account, not reddit/);

      const attached = await server.inject({ method: "PATCH", url: `/api/v1/ingestors/${id}`, payload: { credentialId: reddit.id } });
      expect(attached.statusCode).toBe(200);
      expect(attached.json().config).toEqual({ subreddit: "test", _kind: "test", credentialId: reddit.id });
      const inUse = await server.inject({ method: "DELETE", url: `/api/v1/credentials/${reddit.id}` });
      expect(inUse.statusCode).toBe(409);

      const detached = await server.inject({ method: "PATCH", url: `/api/v1/ingestors/${id}`, payload: { credentialId: null } });
      expect(detached.json().config).toEqual({ subreddit: "test", _kind: "test" });
    } finally {
      side.close();
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
