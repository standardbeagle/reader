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
