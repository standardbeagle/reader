import { sanitizeHtml } from "@reader/core";
import type { Storage, Ingestor, NormalizedItem } from "../storage/types.js";
import type { LlmClient } from "../llm/client.js";
import { processItems, type PipelineResult } from "../llm/pipeline.js";
import { adapters } from "./index.js";
import type { AdapterContext } from "./types.js";

export type FetchFn = (config: Record<string, unknown>, cursor: Record<string, unknown> | null, ctx: AdapterContext) => Promise<{ items: NormalizedItem[]; cursor: Record<string, unknown> }>;

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
      const ctx: AdapterContext = { storage: this.storage, userId: ing.userId };
      const { items, cursor } = await this.fetchFn(ing)(ing.config, ing.cursor, ctx);
      this.storage.stageItems(ing.id, items);
      let kept = 0;
      let dropped = 0;
      if (ing.digestMode === "realtime") {
        const pending = this.storage.pendingItems(ing.id);
        if (pending.length > 0) {
          const result = await this.runPipeline(ing, pending, "original");
          kept = result.kept.length;
          dropped = result.dropped.length;
        }
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
      const result = await this.runPipeline(ing, pending, "delivery");
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

  private async runPipeline(ing: Ingestor, items: NormalizedItem[], publishedAt: "original" | "delivery"): Promise<PipelineResult> {
    // An ingestor configured for LLM filtering must not silently degrade to
    // delivering everything unfiltered when the key later disappears — fail so
    // the error surfaces and the item stays staged for a real run.
    if (ing.llmEnabled && !this.llm) {
      throw new Error("LLM filtering is enabled for this ingestor but no OPENROUTER_API_KEY is configured");
    }
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
          publishedAt: publishedAt === "delivery" ? new Date() : k.item.publishedAt ? new Date(k.item.publishedAt) : null,
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
    if (opts.llmEnabled && !this.llm) {
      throw new Error("LLM filtering is enabled but no OPENROUTER_API_KEY is configured");
    }
    const { items } = await fn(config, null, { storage: this.storage, userId: this.storage.getOrCreateLocalUser().id });
    return processItems(items, { llm: opts.llmEnabled ? this.llm : null, threshold: opts.threshold });
  }
}
