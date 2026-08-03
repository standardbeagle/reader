# Reader M2 — Ingestor framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A framework for social-media ingestors (Mastodon, Bluesky, Reddit) at user-specified pace, with LLM (OpenRouter) clickbait filtering and summarization, landing items in the existing feeds/articles model.

**Architecture:** New `ingestors` + `ingestor_items` tables. Platform adapters produce `NormalizedItem`s. An `IngestorEngine` (own timer in createServer) fetches on fixed user interval, runs the LLM pipeline (filter → summarize, batched, fail-closed), and writes articles into a per-ingestor synthetic feed. Realtime delivers immediately; digest modes stage and flush hourly/daily. API exposes CRUD + a dry-run test endpoint. UI gets an add-ingestor dialog and platform badges.

**Conventions:** tests/build via `tman run -- <cmd>`; conventional commits; no comments unless asked; no placeholders. No network mocks — local fixture servers only.

---

### Task 1: migration + ingestor storage

**Files:**
- Create: `packages/server/src/storage/migrations/0002_ingestors.sql`
- Modify: `packages/server/src/storage/types.ts`
- Modify: `packages/server/src/storage/sqlite.ts`
- Create: `packages/server/test/storage-ingestors.test.ts`

- [ ] **Step 1: Migration**

`packages/server/src/storage/migrations/0002_ingestors.sql`:
```sql
CREATE TABLE ingestors (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('mastodon', 'bluesky', 'reddit')),
  config TEXT NOT NULL,
  feed_id TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  fetch_interval_min INTEGER NOT NULL DEFAULT 60,
  digest_mode TEXT NOT NULL DEFAULT 'realtime' CHECK (digest_mode IN ('realtime', 'hourly', 'daily')),
  filter_threshold INTEGER NOT NULL DEFAULT 5,
  llm_enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'ok',
  error_count INTEGER NOT NULL DEFAULT 0,
  last_fetched_at TEXT,
  last_delivered_at TEXT,
  cursor TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE ingestor_items (
  id TEXT PRIMARY KEY,
  ingestor_id TEXT NOT NULL REFERENCES ingestors(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  delivered_at TEXT,
  UNIQUE (ingestor_id, external_id)
);

CREATE INDEX idx_ingestor_items_pending ON ingestor_items(ingestor_id, delivered_at);
```

- [ ] **Step 2: Types** (append to types.ts)

```ts
export interface NormalizedItem {
  externalId: string;
  author: string | null;
  title: string | null;
  text: string;
  url: string | null;
  publishedAt: string | null;
}

export type IngestorKind = "mastodon" | "bluesky" | "reddit";
export type DigestMode = "realtime" | "hourly" | "daily";

export interface Ingestor {
  id: string;
  userId: string;
  kind: IngestorKind;
  config: Record<string, unknown>;
  feedId: string;
  fetchIntervalMin: number;
  digestMode: DigestMode;
  filterThreshold: number;
  llmEnabled: boolean;
  status: "ok" | "broken";
  errorCount: number;
  lastFetchedAt: string | null;
  lastDeliveredAt: string | null;
  cursor: Record<string, unknown> | null;
  createdAt: string;
}

export interface IngestorPatch {
  fetchIntervalMin?: number;
  digestMode?: DigestMode;
  filterThreshold?: number;
  llmEnabled?: boolean;
}
```

Extend `Storage`:
```ts
  createIngestor(userId: string, input: { kind: IngestorKind; config: Record<string, unknown>; feedId: string }): Ingestor;
  listIngestors(userId: string): Ingestor[];
  getIngestor(id: string): Ingestor | null;
  updateIngestor(id: string, patch: IngestorPatch): Ingestor;
  deleteIngestor(id: string): void;
  dueIngestors(now: Date): Ingestor[];
  dueDigestFlushes(now: Date): Ingestor[];
  updateIngestorState(id: string, state: { lastFetchedAt?: string; lastDeliveredAt?: string; cursor?: Record<string, unknown>; errorCount: number; status: "ok" | "broken" }): void;
  stageItems(ingestorId: string, items: NormalizedItem[]): NormalizedItem[];
  pendingItems(ingestorId: string): NormalizedItem[];
  markDelivered(ingestorId: string, externalIds: string[]): void;
```

- [ ] **Step 3: Failing test**

`packages/server/test/storage-ingestors.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createSqliteStorage } from "../src/storage/sqlite.js";
import type { Storage, Ingestor } from "../src/storage/types.js";

let storage: Storage;
let userId: string;
let feedId: string;

beforeEach(() => {
  storage = createSqliteStorage(":memory:");
  userId = storage.getOrCreateLocalUser().id;
  feedId = storage.createFeed(userId, { url: "ingestor://reddit/r/test", title: "r/test", siteUrl: null }).id;
});
afterEach(() => storage.close());

function makeIngestor(kind: "reddit" | "mastodon" = "reddit") {
  return storage.createIngestor(userId, { kind, config: { subreddit: "test" }, feedId });
}

const item = (n: number) => ({
  externalId: `ext${n}`, author: "a", title: `t${n}`, text: `text ${n}`,
  url: null, publishedAt: new Date("2026-07-01").toISOString(),
});

describe("ingestor storage", () => {
  it("creates with defaults and round-trips config", () => {
    const ing = makeIngestor();
    expect(ing.digestMode).toBe("realtime");
    expect(ing.filterThreshold).toBe(5);
    expect(ing.llmEnabled).toBe(true);
    expect(ing.config).toEqual({ subreddit: "test" });
    expect(storage.getIngestor(ing.id)!.feedId).toBe(feedId);
  });

  it("updateIngestor patches pace fields", () => {
    const ing = makeIngestor();
    const updated = storage.updateIngestor(ing.id, { fetchIntervalMin: 30, digestMode: "daily", filterThreshold: 7, llmEnabled: false });
    expect(updated.fetchIntervalMin).toBe(30);
    expect(updated.digestMode).toBe("daily");
    expect(updated.filterThreshold).toBe(7);
    expect(updated.llmEnabled).toBe(false);
  });

  it("dueIngestors respects fixed interval and skips broken", () => {
    const ing = makeIngestor();
    const past = new Date(Date.now() - 2 * 3600_000).toISOString();
    storage.updateIngestorState(ing.id, { lastFetchedAt: past, errorCount: 0, status: "ok" });
    expect(storage.dueIngestors(new Date()).map((i) => i.id)).toContain(ing.id);
    storage.updateIngestorState(ing.id, { lastFetchedAt: new Date().toISOString(), errorCount: 0, status: "ok" });
    expect(storage.dueIngestors(new Date()).map((i) => i.id)).not.toContain(ing.id);
    storage.updateIngestorState(ing.id, { lastFetchedAt: past, errorCount: 5, status: "broken" });
    expect(storage.dueIngestors(new Date()).map((i) => i.id)).not.toContain(ing.id);
  });

  it("stageItems dedupes by external id", () => {
    const ing = makeIngestor();
    const first = storage.stageItems(ing.id, [item(1), item(2)]);
    const second = storage.stageItems(ing.id, [item(2), item(3)]);
    expect(first.map((i) => i.externalId)).toEqual(["ext1", "ext2"]);
    expect(second.map((i) => i.externalId)).toEqual(["ext3"]);
  });

  it("pendingItems returns only undelivered; markDelivered clears", () => {
    const ing = makeIngestor();
    storage.stageItems(ing.id, [item(1), item(2), item(3)]);
    expect(storage.pendingItems(ing.id)).toHaveLength(3);
    storage.markDelivered(ing.id, ["ext1", "ext2"]);
    expect(storage.pendingItems(ing.id).map((i) => i.externalId)).toEqual(["ext3"]);
  });

  it("dueDigestFlushes picks realtime=never, hourly when overdue", () => {
    const rt = makeIngestor();
    const dg = makeIngestor();
    storage.updateIngestor(dg.id, { digestMode: "hourly" });
    storage.stageItems(dg.id, [item(1)]);
    const past = new Date(Date.now() - 2 * 3600_000).toISOString();
    storage.updateIngestorState(rt.id, { lastDeliveredAt: past, errorCount: 0, status: "ok" });
    storage.updateIngestorState(dg.id, { lastDeliveredAt: past, errorCount: 0, status: "ok" });
    const due = storage.dueDigestFlushes(new Date()).map((i) => i.id);
    expect(due).toContain(dg.id);
    expect(due).not.toContain(rt.id);
    // no pending items → not due even if overdue
    const dg2 = makeIngestor();
    storage.updateIngestor(dg2.id, { digestMode: "daily" });
    storage.updateIngestorState(dg2.id, { lastDeliveredAt: past, errorCount: 0, status: "ok" });
    expect(storage.dueDigestFlushes(new Date()).map((i) => i.id)).not.toContain(dg2.id);
  });

  it("deleteIngestor removes staged items but leaves the feed", () => {
    const ing = makeIngestor();
    storage.stageItems(ing.id, [item(1)]);
    storage.deleteIngestor(ing.id);
    expect(storage.getIngestor(ing.id)).toBeNull();
    expect(storage.getFeed(feedId)).not.toBeNull();
  });
});
```

- [ ] **Step 4: Run to verify failure** — new methods missing.

- [ ] **Step 5: Implement in sqlite.ts**

Row mapper `rowToIngestor` (JSON.parse config/cursor, llmEnabled from 0/1). Implementation notes:
- `dueIngestors`: `WHERE status='ok' AND (last_fetched_at IS NULL OR julianday(last_fetched_at) <= julianday(?) - fetch_interval_min/1440.0)`
- `dueDigestFlushes`: joins against pending items:
```sql
SELECT i.* FROM ingestors i
WHERE i.status = 'ok' AND i.digest_mode != 'realtime'
  AND EXISTS (SELECT 1 FROM ingestor_items s WHERE s.ingestor_id = i.id AND s.delivered_at IS NULL)
  AND (i.last_delivered_at IS NULL
       OR julianday(i.last_delivered_at) <= julianday(?) - (CASE i.digest_mode WHEN 'hourly' THEN 1.0/24 ELSE 1.0 END))
```
- `stageItems`: INSERT ... ON CONFLICT (ingestor_id, external_id) DO NOTHING inside a transaction; return only newly inserted (payload deserialized).
- `markDelivered`: UPDATE ... SET delivered_at = ? WHERE ingestor_id = ? AND external_id IN (placeholders).

- [ ] **Step 6: Run tests** — 7 new green, all existing green. `tman run -- pnpm -r build`.

- [ ] **Step 7: Commit** — `feat(server): add ingestor and staging storage`

---

### Task 2: LLM client + pipeline

**Files:**
- Create: `packages/server/src/llm/client.ts`
- Create: `packages/server/src/llm/pipeline.ts`
- Create: `packages/server/test/llm.test.ts`

- [ ] **Step 1: Failing test with fixture LLM server**

`packages/server/test/llm.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createOpenRouterClient } from "../src/llm/client.js";
import { processItems } from "../src/llm/pipeline.js";
import type { NormalizedItem } from "../src/storage/types.js";

let server: Server;
let baseUrl: string;
let lastBody: string;

async function start(responder: (body: string) => unknown) {
  server = createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      lastBody = data;
      const content = JSON.stringify(responder(data));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
}
afterEach(async () => { await new Promise((r) => server.close(r)); });

const items: NormalizedItem[] = [
  { externalId: "a", author: "x", title: "You won't BELIEVE this", text: "clickbait garbage", url: null, publishedAt: null },
  { externalId: "b", author: "y", title: "Postgres 17 released", text: "New logical replication features and json table improvements.", url: null, publishedAt: null },
];

describe("openrouter client + pipeline", () => {
  it("filterBatch sends items and parses scores", async () => {
    await start(() => [
      { id: "a", score: 1, reason: "pure clickbait" },
      { id: "b", score: 9, reason: "substantive release news" },
    ]);
    const llm = createOpenRouterClient({ apiKey: "test-key", baseUrl, model: "test-model" });
    const result = await processItems(items, { llm, threshold: 5 });
    expect(result.dropped.map((d) => d.item.externalId)).toEqual(["a"]);
    expect(result.kept.map((k) => k.item.externalId)).toEqual(["b"]);
    const sent = JSON.parse(lastBody);
    expect(sent.model).toBe("test-model");
    expect(sent.messages).toHaveLength(2);
  });

  it("summarizeBatch rewrites kept items", async () => {
    let call = 0;
    await start(() => {
      call++;
      if (call === 1) return [{ id: "a", score: 8, reason: "ok" }, { id: "b", score: 9, reason: "ok" }];
      return [
        { id: "a", title: "Believe this", summary: "A factual rewrite." },
        { id: "b", title: "Postgres 17 released", summary: "Postgres 17 adds logical replication upgrades." },
      ];
    });
    const llm = createOpenRouterClient({ apiKey: "k", baseUrl, model: "m" });
    const result = await processItems(items, { llm, threshold: 5 });
    expect(result.kept[0]!.title).toBe("Believe this");
    expect(result.kept[1]!.summary).toContain("logical replication");
    expect(result.kept[0]!.score).toBe(8);
  });

  it("extracts json from prose-wrapped responses", async () => {
    await start(() => "Here are the scores: [{\"id\":\"a\",\"score\":2,\"reason\":\"bait\"},{\"id\":\"b\",\"score\":8,\"reason\":\"good\"}] hope this helps");
    const llm = createOpenRouterClient({ apiKey: "k", baseUrl, model: "m" });
    const result = await processItems(items, { llm, threshold: 5 });
    expect(result.kept.map((k) => k.item.externalId)).toEqual(["b"]);
  });

  it("throws (fails closed) on malformed llm output", async () => {
    await start(() => "no json here at all");
    const llm = createOpenRouterClient({ apiKey: "k", baseUrl, model: "m" });
    await expect(processItems(items, { llm, threshold: 5 })).rejects.toThrow(/llm/i);
  });

  it("raw passthrough when llm is null", async () => {
    const result = await processItems(items, { llm: null, threshold: 5 });
    expect(result.kept).toHaveLength(2);
    expect(result.dropped).toHaveLength(0);
    expect(result.kept[0]!.title).toBe("You won't BELIEVE this");
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement client.ts**

```ts
export interface FilterScore { id: string; score: number; reason: string }
export interface Summary { id: string; title: string; summary: string }

export interface LlmClient {
  filterBatch(items: { id: string; author: string | null; text: string }[]): Promise<FilterScore[]>;
  summarizeBatch(items: { id: string; title: string | null; text: string }[]): Promise<Summary[]>;
}

const FILTER_SYSTEM = `You are a content filter for a power user's feed reader. Score each item 0-10 for signal. Clickbait, ragebait, engagement bait, memes, low-effort jokes, and promotional spam score 0-3. Substantive technical content, informative news, and thoughtful analysis score 7-10. Return ONLY a JSON array of {"id": string, "score": number, "reason": string (max 8 words)}.`;
const SUMMARY_SYSTEM = `Rewrite each item for a feed reader. Return ONLY a JSON array of {"id": string, "title": string (factual, no clickbait, max 10 words), "summary": string (1-2 factual sentences)}. Preserve meaning; no commentary.`;

export function createOpenRouterClient(opts: { apiKey: string; model: string; baseUrl?: string }): LlmClient {
  const base = opts.baseUrl ?? "https://openrouter.ai/api/v1";

  async function chat(system: string, user: string): Promise<unknown[]> {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify({
        model: opts.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`llm request failed: HTTP ${res.status}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content ?? "";
    const start = content.indexOf("[");
    const end = content.lastIndexOf("]");
    if (start === -1 || end === -1 || end <= start) throw new Error("llm returned no json array");
    try {
      return JSON.parse(content.slice(start, end + 1)) as unknown[];
    } catch {
      throw new Error("llm returned malformed json");
    }
  }

  return {
    async filterBatch(items) {
      const user = JSON.stringify(items.map((i) => ({ id: i.id, author: i.author, text: i.text.slice(0, 500) })));
      const out = await chat(FILTER_SYSTEM, user);
      return out.map((r) => {
        const o = r as Record<string, unknown>;
        return { id: String(o.id), score: Number(o.score), reason: String(o.reason ?? "") };
      });
    },
    async summarizeBatch(items) {
      const user = JSON.stringify(items.map((i) => ({ id: i.id, title: i.title, text: i.text.slice(0, 800) })));
      const out = await chat(SUMMARY_SYSTEM, user);
      return out.map((r) => {
        const o = r as Record<string, unknown>;
        return { id: String(o.id), title: String(o.title ?? ""), summary: String(o.summary ?? "") };
      });
    },
  };
}
```

- [ ] **Step 4: Implement pipeline.ts**

```ts
import type { LlmClient } from "./client.js";
import type { NormalizedItem } from "../storage/types.js";

export interface KeptItem { item: NormalizedItem; title: string; summary: string; score: number | null }
export interface DroppedItem { item: NormalizedItem; score: number; reason: string }
export interface PipelineResult { kept: KeptItem[]; dropped: DroppedItem[] }

const BATCH = 20;

export async function processItems(
  items: NormalizedItem[],
  opts: { llm: LlmClient | null; threshold: number },
): Promise<PipelineResult> {
  if (!opts.llm) {
    return {
      kept: items.map((item) => ({
        item,
        title: item.title ?? item.text.slice(0, 80),
        summary: item.text,
        score: null,
      })),
      dropped: [],
    };
  }

  const kept: KeptItem[] = [];
  const dropped: DroppedItem[] = [];
  for (let i = 0; i < items.length; i += BATCH) {
    const chunk = items.slice(i, i + BATCH);
    const scores = await opts.llm.filterBatch(
      chunk.map((item) => ({ id: item.externalId, author: item.author, text: item.text })),
    );
    const scoreBy = new Map(scores.map((s) => [s.id, s]));
    const passing: { item: NormalizedItem; score: number }[] = [];
    for (const item of chunk) {
      const s = scoreBy.get(item.externalId);
      if (s === undefined) throw new Error(`llm filter missing score for item ${item.externalId}`);
      if (s.score >= opts.threshold) passing.push({ item, score: s.score });
      else dropped.push({ item, score: s.score, reason: s.reason });
    }
    if (passing.length > 0) {
      const summaries = await opts.llm.summarizeBatch(
        passing.map((p) => ({ id: p.item.externalId, title: p.item.title, text: p.item.text })),
      );
      const summaryBy = new Map(summaries.map((s) => [s.id, s]));
      for (const p of passing) {
        const s = summaryBy.get(p.item.externalId);
        if (s === undefined) throw new Error(`llm summary missing for item ${p.item.externalId}`);
        kept.push({
          item: p.item,
          title: s.title || p.item.title || p.item.text.slice(0, 80),
          summary: s.summary || p.item.text,
          score: p.score,
        });
      }
    }
  }
  return { kept, dropped };
}
```

- [ ] **Step 5: Run tests** — 5 new green; full suite green. `tman run -- pnpm -r build`.

- [ ] **Step 6: Commit** — `feat(server): add openrouter llm client and filter pipeline`

---

### Task 3: platform adapters

**Files:**
- Create: `packages/server/src/ingestors/types.ts`
- Create: `packages/server/src/ingestors/mastodon.ts`
- Create: `packages/server/src/ingestors/bluesky.ts`
- Create: `packages/server/src/ingestors/reddit.ts`
- Create: `packages/server/src/ingestors/index.ts`
- Create: `packages/server/test/adapters.test.ts`

- [ ] **Step 1: types.ts**

```ts
import type { NormalizedItem } from "../storage/types.js";

export interface AdapterResult {
  items: NormalizedItem[];
  cursor: Record<string, unknown>;
}

export interface IngestorAdapter {
  validate(config: Record<string, unknown>): Promise<string>;
  fetch(config: Record<string, unknown>, cursor: Record<string, unknown> | null): Promise<AdapterResult>;
}
```

- [ ] **Step 2: Failing tests (fixture servers per platform)**

`packages/server/test/adapters.test.ts` — fixture server dispatches per path; adapters get `_baseUrl` config override for tests:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mastodonAdapter } from "../src/ingestors/mastodon.js";
import { blueskyAdapter } from "../src/ingestors/bluesky.js";
import { redditAdapter } from "../src/ingestors/reddit.js";

let server: Server;
let baseUrl: string;

async function start(routes: Record<string, unknown>) {
  server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    const hit = Object.entries(routes).find(([path]) => u.pathname === path);
    if (!hit) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(hit[1]));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
afterEach(async () => { await new Promise((r) => server.close(r)); });

describe("mastodon adapter", () => {
  const timeline = [
    { id: "101", created_at: "2026-07-01T12:00:00Z", url: "https://mastodon.social/@a/101", content: "<p>Hello <b>world</b></p>", account: { acct: "alice@mastodon.social" } },
    { id: "100", created_at: "2026-06-30T12:00:00Z", url: "https://mastodon.social/@a/100", content: "<p>Earlier</p>", account: { acct: "alice@mastodon.social" } },
  ];
  it("fetches a tag timeline, strips html, cursors by max_id", async () => {
    let sawMaxId: string | null = null;
    await start({});
    server.close();
    server = createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://x");
      if (u.pathname === "/api/v1/timelines/tag/ai") {
        sawMaxId = u.searchParams.get("max_id");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(timeline));
      } else res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen((server.address() as AddressInfo)?.port ?? 0, "127.0.0.1", r));
    const cfg = { instance: new URL(baseUrl).host, tag: "ai", _baseUrl: baseUrl };
    const first = await mastodonAdapter.fetch(cfg, null);
    expect(first.items).toHaveLength(2);
    expect(first.items[0]!.text).toBe("Hello world");
    expect(first.items[0]!.author).toBe("alice@mastodon.social");
    expect(first.cursor).toEqual({ maxId: "100" });
    const second = await mastodonAdapter.fetch(cfg, first.cursor);
    expect(sawMaxId).toBe("100");
    expect(second.items[0]!.externalId).toBe("101");
  });
});

describe("bluesky adapter", () => {
  const feed = {
    feed: [
      { post: { uri: "at://did:plc:x/app.bsky.feed.post/abc", cid: "c1", author: { handle: "bob.bsky.social" }, record: { text: "shipping today", createdAt: "2026-07-01T10:00:00Z" } } },
    ],
    cursor: "page2",
  };
  it("fetches author feed and normalizes urls", async () => {
    await start({ "/xrpc/app.bsky.feed.getAuthorFeed": feed });
    const cfg = { handle: "bob.bsky.social", _baseUrl: baseUrl };
    const result = await blueskyAdapter.fetch(cfg, null);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.externalId).toBe("at://did:plc:x/app.bsky.feed.post/abc");
    expect(result.items[0]!.url).toBe("https://bsky.app/profile/bob.bsky.social/post/abc");
    expect(result.items[0]!.text).toBe("shipping today");
    expect(result.cursor).toEqual({ cursor: "page2" });
  });
});

describe("reddit adapter", () => {
  const listing = {
    data: {
      children: [
        { data: { name: "t3_aaa", title: "Big news", selftext: "body", author: "carol", permalink: "/r/technology/comments/aaa/big_news/", url: "https://example.com/story", created_utc: 1783000000, score: 42 } },
      ],
      after: "t3_aaa",
    },
  };
  it("fetches subreddit listing and normalizes", async () => {
    await start({ "/r/technology/new.json": listing });
    const cfg = { subreddit: "technology", _baseUrl: baseUrl };
    const result = await redditAdapter.fetch(cfg, null);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.externalId).toBe("t3_aaa");
    expect(result.items[0]!.title).toBe("Big news");
    expect(result.items[0]!.text).toContain("body");
    expect(result.items[0]!.url).toBe("https://example.com/story");
    expect(result.cursor).toEqual({ after: "t3_aaa" });
  });
});
```

(Note for implementer: the mastodon restart dance above is awkward — simpler to make the fixture route handler a mutable closure; rewrite the mastodon test with a `let handler` pattern like fixtureServer.ts. Keep assertions identical.)

- [ ] **Step 3: Run to verify failure.**

- [ ] **Step 4: Implement adapters**

`mastodon.ts`:
```ts
import { fetchCapped } from "../fetch.js";
import type { IngestorAdapter } from "./types.js";

function stripHtml(html: string): string {
  return html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>\s*<p>/gi, "\n\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

function base(cfg: Record<string, unknown>): string {
  return (cfg._baseUrl as string) ?? `https://${cfg.instance}`;
}

export const mastodonAdapter: IngestorAdapter = {
  async validate(config) {
    if (!config.instance) throw new Error("mastodon config requires instance");
    if (!config.tag && !config.account) throw new Error("mastodon config requires tag or account");
    const res = await fetchCapped(`${base(config)}/api/v1/instance`, { maxBytes: 1024 * 1024 });
    if (res.status !== 200) throw new Error(`mastodon instance unreachable: HTTP ${res.status}`);
    const label = config.tag ? `#${config.tag}` : String(config.account);
    return `Mastodon ${label}@${config.instance}`;
  },
  async fetch(config, cursor) {
    const maxId = cursor?.maxId as string | undefined;
    const params = new URLSearchParams({ limit: "40" });
    if (maxId) params.set("max_id", maxId);
    const path = config.tag
      ? `/api/v1/timelines/tag/${encodeURIComponent(String(config.tag))}`
      : `/api/v1/accounts/${encodeURIComponent(String(config.account))}/statuses`;
    const res = await fetchCapped(`${base(config)}${path}?${params}`, { maxBytes: 5 * 1024 * 1024 });
    if (res.status !== 200) throw new Error(`mastodon fetch failed: HTTP ${res.status}`);
    const statuses = JSON.parse(res.body) as Record<string, unknown>[];
    const items = statuses.map((s) => ({
      externalId: String(s.id),
      author: (s.account as Record<string, unknown>)?.acct as string ?? null,
      title: null,
      text: stripHtml(String(s.content ?? "")),
      url: (s.url as string) ?? null,
      publishedAt: (s.created_at as string) ?? null,
    }));
    const last = statuses[statuses.length - 1];
    return { items, cursor: { maxId: last ? String(last.id) : maxId ?? null } };
  },
};
```

`bluesky.ts`:
```ts
import { fetchCapped } from "../fetch.js";
import type { IngestorAdapter } from "./types.js";

const PUBLIC_API = "https://public.api.bsky.app";

export const blueskyAdapter: IngestorAdapter = {
  async validate(config) {
    if (!config.handle && !config.search) throw new Error("bluesky config requires handle or search");
    return config.handle ? `Bluesky @${config.handle}` : `Bluesky "${config.search}"`;
  },
  async fetch(config, cursor) {
    const base = (config._baseUrl as string) ?? PUBLIC_API;
    const params = new URLSearchParams({ limit: "30" });
    if (cursor?.cursor) params.set("cursor", String(cursor.cursor));
    const path = config.handle
      ? `/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(String(config.handle))}&${params}`
      : `/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(String(config.search))}&${params}`;
    const res = await fetchCapped(`${base}${path}`, { maxBytes: 5 * 1024 * 1024 });
    if (res.status !== 200) throw new Error(`bluesky fetch failed: HTTP ${res.status}`);
    const data = JSON.parse(res.body) as { feed?: { post: Record<string, unknown> }[]; posts?: Record<string, unknown>[]; cursor?: string };
    const posts = data.feed ? data.feed.map((f) => f.post) : (data.posts ?? []);
    const items = posts.map((p) => {
      const uri = String(p.uri);
      const rkey = uri.split("/").pop() ?? "";
      const author = (p.author as Record<string, unknown>)?.handle as string ?? null;
      const record = p.record as Record<string, unknown>;
      return {
        externalId: uri,
        author,
        title: null,
        text: String(record?.text ?? ""),
        url: author && rkey ? `https://bsky.app/profile/${author}/post/${rkey}` : null,
        publishedAt: (record?.createdAt as string) ?? null,
      };
    });
    return { items, cursor: { cursor: data.cursor ?? null } };
  },
};
```

`reddit.ts`:
```ts
import { fetchCapped } from "../fetch.js";
import type { IngestorAdapter } from "./types.js";

export const redditAdapter: IngestorAdapter = {
  async validate(config) {
    if (!config.subreddit) throw new Error("reddit config requires subreddit");
    return `r/${config.subreddit}`;
  },
  async fetch(config, cursor) {
    const base = (config._baseUrl as string) ?? "https://www.reddit.com";
    const sort = (config.sort as string) ?? "new";
    const params = new URLSearchParams({ limit: "25" });
    if (cursor?.after) params.set("after", String(cursor.after));
    const res = await fetchCapped(
      `${base}/r/${encodeURIComponent(String(config.subreddit))}/${sort}.json?${params}`,
      { maxBytes: 5 * 1024 * 1024, headers: { "user-agent": "reader/0.1 (feed reader)" } },
    );
    if (res.status !== 200) throw new Error(`reddit fetch failed: HTTP ${res.status}`);
    const listing = JSON.parse(res.body) as { data: { children: { data: Record<string, unknown> }[]; after: string | null } };
    const items = listing.data.children.map((c) => {
      const d = c.data;
      const selftext = String(d.selftext ?? "");
      const linkUrl = String(d.url ?? "");
      const permalink = `https://www.reddit.com${d.permalink}`;
      return {
        externalId: String(d.name),
        author: (d.author as string) ?? null,
        title: String(d.title ?? ""),
        text: selftext || linkUrl || String(d.title ?? ""),
        url: d.is_self ? permalink : linkUrl || permalink,
        publishedAt: d.created_utc ? new Date(Number(d.created_utc) * 1000).toISOString() : null,
      };
    });
    return { items, cursor: { after: listing.data.after } };
  },
};
```

`ingestors/index.ts`:
```ts
import type { IngestorAdapter } from "./types.js";
import type { IngestorKind } from "../storage/types.js";
import { mastodonAdapter } from "./mastodon.js";
import { blueskyAdapter } from "./bluesky.js";
import { redditAdapter } from "./reddit.js";

export const adapters: Record<IngestorKind, IngestorAdapter> = {
  mastodon: mastodonAdapter,
  bluesky: blueskyAdapter,
  reddit: redditAdapter,
};
export type { IngestorAdapter } from "./types.js";
```

- [ ] **Step 5: Run tests** — adapter tests green, full suite green, build green.

- [ ] **Step 6: Commit** — `feat(server): add mastodon, bluesky, reddit adapters`

---

### Task 4: ingestor engine

**Files:**
- Create: `packages/server/src/ingestors/engine.ts`
- Create: `packages/server/test/engine.test.ts`

- [ ] **Step 1: Failing tests**

`packages/server/test/engine.test.ts`:
```ts
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
    expect(storage.listArticles({ userId, feedId: ing.feedId, limit: 50 })).toHaveLength(2);
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
```

(Note for implementer: engine constructor takes (storage, llm, adapters override map) — the override map lets tests inject fake adapters keyed by `config._kind`; production wiring uses the real `adapters` record. Design the signature as `new IngestorEngine(storage, llm, adaptersOverride?)` where override maps `config._kind ?? ingestor.kind` → fetch fn. The `_kind` test key must take precedence when present.)

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement engine.ts**

```ts
import { sanitizeHtml } from "@reader/core";
import type { Storage, Ingestor, NormalizedItem } from "../storage/types.js";
import type { LlmClient } from "../llm/client.js";
import { processItems, type PipelineResult } from "../llm/pipeline.js";
import { adapters } from "./index.js";

type FetchFn = (config: Record<string, unknown>, cursor: Record<string, unknown> | null) => Promise<{ items: NormalizedItem[]; cursor: Record<string, unknown> }>;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export class IngestorEngine {
  constructor(
    private readonly storage: Storage,
    private readonly llm: LlmClient | null,
    private readonly adapterOverride?: Record<string, FetchFn>,
  ) {}

  private fetchFn(ing: Ingestor): FetchFn {
    const key = (ing.config._kind as string) ?? ing.kind;
    const fn = this.adapterOverride?.[key] ?? adapters[ing.kind]?.fetch.bind(adapters[ing.kind]);
    if (!fn) throw new Error(`no adapter for kind ${ing.kind}`);
    return fn;
  }

  async processIngestor(id: string): Promise<{ fetched: number; kept: number; dropped: number } | { error: string }> {
    const ing = this.storage.getIngestor(id);
    if (!ing) return { error: "ingestor not found" };
    if (ing.status === "broken") return { error: "ingestor broken" };
    try {
      const { items, cursor } = await this.fetchFn(ing)(ing.config, ing.cursor);
      const fresh = this.storage.stageItems(ing.id, items);
      let kept = 0;
      let dropped = 0;
      if (ing.digestMode === "realtime" && fresh.length > 0) {
        const result = await this.runPipeline(ing, fresh);
        kept = result.kept.length;
        dropped = result.dropped.length;
      }
      this.storage.updateIngestorState(ing.id, {
        lastFetchedAt: new Date().toISOString(), cursor, errorCount: 0, status: "ok",
      });
      return { fetched: items.length, kept, dropped };
    } catch (e) {
      this.storage.updateIngestorState(ing.id, {
        lastFetchedAt: new Date().toISOString(),
        errorCount: ing.errorCount + 1,
        status: ing.errorCount + 1 >= 10 ? "broken" : "ok",
      });
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  async flushDigest(id: string): Promise<{ kept: number; dropped: number } | { error: string }> {
    const ing = this.storage.getIngestor(id);
    if (!ing) return { error: "ingestor not found" };
    const pending = this.storage.pendingItems(ing.id);
    if (pending.length === 0) return { kept: 0, dropped: 0 };
    try {
      const result = await this.runPipeline(ing, pending);
      this.storage.updateIngestorState(ing.id, { lastDeliveredAt: new Date().toISOString(), errorCount: 0, status: "ok" });
      return { kept: result.kept.length, dropped: result.dropped.length };
    } catch (e) {
      this.storage.updateIngestorState(ing.id, {
        errorCount: ing.errorCount + 1,
        status: ing.errorCount + 1 >= 10 ? "broken" : "ok",
      });
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  private async runPipeline(ing: Ingestor, items: NormalizedItem[]): Promise<PipelineResult> {
    const result = await processItems(items, {
      llm: ing.llmEnabled ? this.llm : null,
      threshold: ing.filterThreshold,
    });
    if (result.kept.length > 0) {
      this.storage.upsertArticles(
        ing.feedId,
        result.kept.map((k) => ({
          guid: `ing:${ing.id}:${k.item.externalId}`,
          url: k.item.url,
          title: k.title,
          author: k.item.author,
          publishedAt: k.item.publishedAt ? new Date(k.item.publishedAt) : null,
          contentHtml: `<p>${escapeHtml(k.summary)}</p>` + (k.item.url ? `<p><a href="${escapeHtml(k.item.url)}">View original</a></p>` : ""),
          summary: k.summary,
        })),
        sanitizeHtml,
      );
      this.storage.markDelivered(ing.id, result.kept.map((k) => k.item.externalId));
    }
    if (result.dropped.length > 0) {
      this.storage.markDelivered(ing.id, result.dropped.map((d) => d.item.externalId));
    }
    return result;
  }

  async tick(): Promise<void> {
    const now = new Date();
    const due = this.storage.dueIngestors(now);
    for (const ing of due) await this.processIngestor(ing.id);
    const flushes = this.storage.dueDigestFlushes(now);
    for (const ing of flushes) await this.flushDigest(ing.id);
  }

  async testRun(kind: string, config: Record<string, unknown>, opts: { threshold: number; llmEnabled: boolean }) {
    const key = (config._kind as string) ?? kind;
    const fn = this.adapterOverride?.[key] ?? adapters[key as keyof typeof adapters]?.fetch.bind(adapters[key as keyof typeof adapters]);
    if (!fn) throw new Error(`no adapter for kind ${kind}`);
    const { items } = await fn(config, null);
    return processItems(items, { llm: opts.llmEnabled ? this.llm : null, threshold: opts.threshold });
  }
}
```

- [ ] **Step 4: Run tests** — 6 new green, suite green, build green.

- [ ] **Step 5: Commit** — `feat(server): add ingestor engine with realtime and digest delivery`

---

### Task 5: API routes + server wiring

**Files:**
- Create: `packages/server/src/api/routes-ingestors.ts`
- Modify: `packages/server/src/api/server.ts`
- Modify: `packages/server/src/api/routes.ts` (register ingestor routes — or register from server.ts; pick server.ts)
- Create: `packages/server/test/api-ingestors.test.ts`

- [ ] **Step 1: Failing tests**

`packages/server/test/api-ingestors.test.ts` — use createServer with injected engine overrides. This requires createServer to accept an optional `ingestorAdapters` option passed to IngestorEngine (test seam, like `poller: false`). Tests:
```ts
// POST /api/v1/ingestors {kind:"reddit", config:{subreddit:"test", _kind:"test"}, fetchIntervalMin:30}
//   → 201, ingestor with feed; feed url ingestor://reddit/r/test; title from adapter.validate
// POST with kind bogus → 400
// POST with llmEnabled true but server has no OPENROUTER_API_KEY → 400 llm_not_configured
// GET /api/v1/ingestors → includes created ingestor + feedTitle
// PATCH /api/v1/ingestors/:id {filterThreshold: 8, digestMode: "hourly"} → updated
// DELETE /api/v1/ingestors/:id → 204; feed gone too (cascade via deleteFeed)
// POST /api/v1/ingestors/test {kind, config:{_kind:"test"}, threshold:5} → {kept:[...], dropped:[...]} with fake adapter + fake llm
```
For the test seam, createServer opts gain `ingestorAdapters?: Record<string, FetchFn>` and `llm?: LlmClient | null` (default: build from OPENROUTER_API_KEY env, else null). The fake adapter returns items containing "bait" so fakeLlm drops one.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement routes-ingestors.ts**

```ts
import type { FastifyInstance } from "fastify";
import type { Storage, IngestorKind, DigestMode } from "../storage/types.js";
import type { IngestorEngine } from "../ingestors/engine.js";
import { adapters } from "../ingestors/index.js";

interface CreateBody {
  kind?: string; config?: Record<string, unknown>;
  fetchIntervalMin?: number; digestMode?: string;
  filterThreshold?: number; llmEnabled?: boolean;
}
interface PatchBody {
  fetchIntervalMin?: number; digestMode?: DigestMode;
  filterThreshold?: number; llmEnabled?: boolean;
}

const KINDS = ["mastodon", "bluesky", "reddit"];

export function registerIngestorRoutes(app: FastifyInstance, storage: Storage, engine: IngestorEngine, llmConfigured: boolean): void {
  const userId = () => storage.getOrCreateLocalUser().id;

  app.get("/api/v1/ingestors", async () => {
    const uid = userId();
    return {
      ingestors: storage.listIngestors(uid).map((i) => ({
        ...i,
        feedTitle: storage.getFeed(i.feedId)?.title ?? null,
        pendingCount: storage.pendingItems(i.id).length,
      })),
    };
  });

  app.post<{ Body: CreateBody }>("/api/v1/ingestors", async (req, reply) => {
    const { kind, config } = req.body ?? {};
    if (!kind || !KINDS.includes(kind) || !config || typeof config !== "object") {
      return reply.code(400).send({ error: { code: "invalid_ingestor", message: "kind (mastodon|bluesky|reddit) and config object are required" } });
    }
    if (req.body?.llmEnabled !== false && !llmConfigured) {
      return reply.code(400).send({ error: { code: "llm_not_configured", message: "LLM filtering is on but the server has no OPENROUTER_API_KEY. Set the key or disable LLM filtering." } });
    }
    const adapter = adapters[kind as IngestorKind];
    let title: string;
    try {
      title = await adapter.validate(config);
    } catch (e) {
      return reply.code(422).send({ error: { code: "ingestor_invalid", message: e instanceof Error ? e.message : String(e) } });
    }
    const key = config.subreddit ? `r/${config.subreddit}` : config.tag ? `tag/${config.tag}` : config.handle ?? config.search ?? "feed";
    const feed = storage.createFeed(userId(), { url: `ingestor://${kind}/${key}`, title, siteUrl: null });
    const ingestor = storage.createIngestor(userId(), { kind: kind as IngestorKind, config, feedId: feed.id });
    const patched = storage.updateIngestor(ingestor.id, {
      ...(req.body?.fetchIntervalMin ? { fetchIntervalMin: Math.max(5, Math.min(1440, req.body.fetchIntervalMin)) } : {}),
      ...(req.body?.digestMode && ["realtime", "hourly", "daily"].includes(req.body.digestMode) ? { digestMode: req.body.digestMode as DigestMode } : {}),
      ...(req.body?.filterThreshold !== undefined ? { filterThreshold: Math.max(0, Math.min(10, req.body.filterThreshold)) } : {}),
      ...(req.body?.llmEnabled !== undefined ? { llmEnabled: req.body.llmEnabled } : {}),
    });
    engine.processIngestor(patched.id).catch(() => {});
    return reply.code(201).send(patched);
  });

  app.patch<{ Params: { id: string }; Body: PatchBody }>("/api/v1/ingestors/:id", async (req, reply) => {
    if (!storage.getIngestor(req.params.id)) {
      return reply.code(404).send({ error: { code: "not_found", message: "ingestor not found" } });
    }
    if (req.body?.llmEnabled === true && !llmConfigured) {
      return reply.code(400).send({ error: { code: "llm_not_configured", message: "LLM filtering is on but the server has no OPENROUTER_API_KEY." } });
    }
    const updated = storage.updateIngestor(req.params.id, {
      ...(req.body?.fetchIntervalMin ? { fetchIntervalMin: Math.max(5, Math.min(1440, req.body.fetchIntervalMin)) } : {}),
      ...(req.body?.digestMode && ["realtime", "hourly", "daily"].includes(req.body.digestMode) ? { digestMode: req.body.digestMode as DigestMode } : {}),
      ...(req.body?.filterThreshold !== undefined ? { filterThreshold: Math.max(0, Math.min(10, req.body.filterThreshold)) } : {}),
      ...(req.body?.llmEnabled !== undefined ? { llmEnabled: req.body.llmEnabled } : {}),
    });
    return updated;
  });

  app.delete<{ Params: { id: string } }>("/api/v1/ingestors/:id", async (req, reply) => {
    const ing = storage.getIngestor(req.params.id);
    if (!ing) return reply.code(404).send({ error: { code: "not_found", message: "ingestor not found" } });
    const feedId = ing.feedId;
    storage.deleteIngestor(ing.id);
    storage.deleteFeed(feedId);
    return reply.code(204).send();
  });

  app.post<{ Body: { kind?: string; config?: Record<string, unknown>; threshold?: number; llmEnabled?: boolean } }>("/api/v1/ingestors/test", async (req, reply) => {
    const { kind, config } = req.body ?? {};
    if (!kind || !KINDS.includes(kind) || !config) {
      return reply.code(400).send({ error: { code: "invalid_ingestor", message: "kind and config are required" } });
    }
    if (req.body?.llmEnabled !== false && !llmConfigured) {
      return reply.code(400).send({ error: { code: "llm_not_configured", message: "LLM filtering is on but the server has no OPENROUTER_API_KEY." } });
    }
    try {
      const result = await engine.testRun(kind, config, {
        threshold: req.body?.threshold ?? 5,
        llmEnabled: req.body?.llmEnabled !== false,
      });
      return {
        kept: result.kept.map((k) => ({ title: k.title, summary: k.summary, score: k.score, url: k.item.url, author: k.item.author })),
        dropped: result.dropped.map((d) => ({ title: d.item.title ?? d.item.text.slice(0, 80), score: d.score, reason: d.reason })),
      };
    } catch (e) {
      return reply.code(422).send({ error: { code: "ingestor_test_failed", message: e instanceof Error ? e.message : String(e) } });
    }
  });
}
```

- [ ] **Step 4: Wire server.ts**

In createServer opts add `ingestorAdapters?: Record<string, FetchFn>`, `llm?: LlmClient | null`, `ingestorTickMs?: number`. Construct:
```ts
const llm = opts.llm !== undefined ? opts.llm
  : process.env.OPENROUTER_API_KEY
    ? createOpenRouterClient({ apiKey: process.env.OPENROUTER_API_KEY, model: process.env.READER_LLM_MODEL ?? "google/gemini-2.0-flash-001" })
    : null;
const engine = new IngestorEngine(storage, llm, opts.ingestorAdapters);
registerIngestorRoutes(app, storage, engine, llm !== null);
```
Engine timer: when `opts.poller !== false`, start `setInterval(() => engine.tick().catch(...), opts.ingestorTickMs ?? 60_000)` + immediate first tick, unref, cleared in onClose. Guard overlapping engine ticks with a boolean like the poller's.

- [ ] **Step 5: Run tests** — new api-ingestor tests green, full suite green, build green.

- [ ] **Step 6: Commit** — `feat(server): add ingestor api routes and engine wiring`

---

### Task 6: UI — add-ingestor dialog + badges

**Files:**
- Create: `apps/web/src/IngestorDialog.tsx`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/Sidebar.tsx`
- Modify: `apps/web/src/styles.css` (dialog form styles, platform badge)

- [ ] **Step 1: api.ts additions**

```ts
export interface Ingestor {
  id: string; kind: "mastodon" | "bluesky" | "reddit"; config: Record<string, unknown>;
  feedId: string; feedTitle: string | null; fetchIntervalMin: number;
  digestMode: "realtime" | "hourly" | "daily"; filterThreshold: number;
  llmEnabled: boolean; status: "ok" | "broken"; pendingCount: number;
}
export interface IngestorTestResult {
  kept: { title: string; summary: string; score: number | null; url: string | null; author: string | null }[];
  dropped: { title: string; score: number; reason: string }[];
}
// api additions:
listIngestors: () => req<{ ingestors: Ingestor[] }>("/api/v1/ingestors").then((r) => r.ingestors),
createIngestor: (input: { kind: string; config: Record<string, unknown>; fetchIntervalMin?: number; digestMode?: string; filterThreshold?: number; llmEnabled?: boolean }) =>
  req<Ingestor>("/api/v1/ingestors", { method: "POST", json: input }),
updateIngestor: (id: string, patch: Partial<{ fetchIntervalMin: number; digestMode: string; filterThreshold: number; llmEnabled: boolean }>) =>
  req<Ingestor>(`/api/v1/ingestors/${id}`, { method: "PATCH", json: patch }),
deleteIngestor: (id: string) => req<void>(`/api/v1/ingestors/${id}`, { method: "DELETE" }),
testIngestor: (input: { kind: string; config: Record<string, unknown>; threshold?: number; llmEnabled?: boolean }) =>
  req<IngestorTestResult>("/api/v1/ingestors/test", { method: "POST", json: input }),
```
Note: req() currently sets content-type only for json — PATCH works the same. Also extend the Feed interface client-side: derive platform badge from `feed.url.startsWith("ingestor://")` — add helper `feedPlatform(url: string): string | null` in api.ts returning "mastodon"|"bluesky"|"reddit"|null.

- [ ] **Step 2: IngestorDialog.tsx**

A modal (reuse .overlay/.picker classes with a wider .dialog class): 
- Platform select (Mastodon / Bluesky / Reddit)
- Per-platform config fields:
  - mastodon: instance (text, placeholder "mastodon.social"), tag (text, optional, "without #")
  - bluesky: handle (text, optional) OR search (text, optional) — one required
  - reddit: subreddit (text), sort select (new/hot/top)
- Fetch every: number input (minutes, 5–1440, default 60)
- Delivery: select realtime/hourly/daily
- LLM filtering: checkbox (default on) + threshold range input 0–10 with live value (disabled when checkbox off)
- Buttons: [Test] [Subscribe] [Cancel]
- Test: calls testIngestor with current form state; renders result below: kept list (title + score + summary snippet) and dropped list (title + score + reason), each capped at 5 rows; errors via ErrorCallout.
- Subscribe: createIngestor; on success close + invalidate ["feeds"] and ["ingestors"]; on error show ErrorCallout with the error code (llm_not_configured and ingestor_invalid are new codes — add catalog entries:
  - llm_not_configured: title "LLM filtering isn't set up", explanation "This ingestor wants to filter content with an LLM, but the server has no OpenRouter API key configured.", steps ["Set OPENROUTER_API_KEY on the server and restart it", "Or turn off LLM filtering for this ingestor"]
  - ingestor_invalid: title "Can't reach that source", explanation "The platform rejected this configuration — the instance, handle, or subreddit may be wrong or unreachable.", steps ["Double-check the spelling", "For Mastodon, use the bare instance domain like mastodon.social", "For Reddit, use the subreddit name without r/"]
  - ingestor_test_failed: title "Test run failed", explanation "Fetching or filtering this source failed.", steps ["Check the source settings", "Try again in a moment"])

- [ ] **Step 3: Sidebar wiring**

- Add a small "+ Ingestor" button under the subscribe form (class .ingestor-btn).
- Dialog state in Sidebar; render IngestorDialog when open.
- Feed rows: when `feedPlatform(f.url)` non-null, render `<span className="platform-badge">{platform}</span>` before the title.
- Sidebar data: also useQuery(["ingestors"]) to show pending digest counts: if an ingestor for that feed has pendingCount > 0 and digestMode != realtime, show `(+N pending)` in .count-dim next to unread count. Keep simple: append ` · +N` to the count span when pending.

- [ ] **Step 4: styles**

```css
.ingestor-btn { width: 100%; padding: 5px; margin-bottom: var(--space-3); border: 1px dashed var(--border-strong); color: var(--text-dim); font-size: var(--fs-sm); }
.ingestor-btn:hover { color: var(--text); border-color: var(--accent); }
.platform-badge { font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--accent-text); background: var(--accent-bg); padding: 1px 5px; border-radius: 3px; flex-shrink: 0; }
.dialog { width: min(600px, calc(100vw - 32px)); }
.dialog label { display: block; font-size: var(--fs-sm); color: var(--text-dim); margin: var(--space-2) 0 2px; }
.dialog input[type="text"], .dialog input[type="number"], .dialog select { width: 100%; padding: 5px 8px; }
.dialog .row { display: flex; gap: var(--space-3); }
.dialog .row > div { flex: 1; }
.dialog .actions { display: flex; gap: var(--space-2); margin-top: var(--space-4); }
.dialog .actions .primary { background: var(--accent); color: var(--accent-contrast); padding: 5px 12px; font-weight: 600; }
.dialog .test-results { margin-top: var(--space-3); border-top: 1px solid var(--border); padding-top: var(--space-2); max-height: 240px; overflow-y: auto; }
.dialog .test-results h4 { margin: var(--space-2) 0 2px; font-size: var(--fs-sm); }
.dialog .test-results li { font-size: var(--fs-sm); padding: 2px 0; }
.dialog .score { font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--accent-text); }
.dialog .reason { color: var(--text-dim); font-size: var(--fs-xs); }
.dialog input[type="range"] { width: 100%; }
```

- [ ] **Step 5: Verify** — web tests green, `tman run -- pnpm -r build` green, `tman run -- pnpm -r test` green.

- [ ] **Step 6: Commit** — `feat(web): add ingestor dialog with pace controls and test preview`

---

### Task 7: closeout + deploy

- [ ] Full suite + build green.
- [ ] LLM error catalog entries present for all new codes.
- [ ] Rebuild + restart deployed service; instruct user to create `~/.config/reader/env` with `OPENROUTER_API_KEY=<their key>` themselves (agent never writes the value); add `EnvironmentFile=-%h/.config/reader/env` to reader.service.
- [ ] Controller runs agnt audit: add-ingestor dialog flow end-to-end (reddit test run with real LLM), digest badge display, screenshots.
