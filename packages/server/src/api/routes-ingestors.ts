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
