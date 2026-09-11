import Fastify, { type FastifyInstance } from "fastify";
import { createSqliteStorage } from "../storage/sqlite.js";
import { Poller } from "../poller/poller.js";
import { registerRoutes } from "./routes.js";
import { registerIngestorRoutes } from "./routes-ingestors.js";
import { registerListRoutes } from "./routes-lists.js";
import { registerAuthRoutes } from "./routes-auth.js";
import { registerPodcastRoutes } from "./routes-podcast.js";
import { RealtimeHub } from "../realtime/hub.js";
import { DEFAULT_PODPING_URL } from "../realtime/podping.js";
import { IngestorEngine, type FetchFn } from "../ingestors/engine.js";
import { createOpenRouterClient, type LlmClient } from "../llm/client.js";

export interface ServerOptions {
  dbPath: string;
  poller?: boolean;
  tickMs?: number;
  ingestorAdapters?: Record<string, FetchFn>;
  llm?: LlmClient | null;
  ingestorTickMs?: number;
  /** Podping relay URL; null disables it. Defaults to READER_PODPING_URL or the public relay. */
  podpingUrl?: string | null;
}

const BACKGROUND_START_DELAY_MS = 8_000;

export async function createServer(opts: ServerOptions): Promise<FastifyInstance> {
  const storage = createSqliteStorage(opts.dbPath);
  const poller = new Poller(storage, opts.tickMs !== undefined ? { tickMs: opts.tickMs } : {});
  if (opts.poller !== false) poller.start();

  const llm = opts.llm !== undefined ? opts.llm
    : process.env.OPENROUTER_API_KEY
      ? createOpenRouterClient({ apiKey: process.env.OPENROUTER_API_KEY, model: process.env.READER_LLM_MODEL ?? "google/gemini-2.0-flash-001" })
      : null;
  const engine = new IngestorEngine(storage, llm, opts.ingestorAdapters);
  // Declared caps for this listener (AGENTS.md: every listener names its ceilings).
  // Loopback posture, but unbounded is a defect regardless of exposure.
  const app = Fastify({
    logger: true,
    bodyLimit: 1_048_576, // 1 MiB — API bodies are small JSON
    connectionTimeout: 10_000,
    keepAliveTimeout: 30_000,
    requestTimeout: 30_000,
  });
  app.server.maxConnections = 256;
  let engineTicking = false;
  const runEngineTick = async () => {
    if (engineTicking) return;
    engineTicking = true;
    await engine.tick().catch((e) => app.log.warn(e, "ingestor tick failed"));
    engineTicking = false;
  };
  let engineTimer: NodeJS.Timeout | null = null;
  let engineStartupTimer: NodeJS.Timeout | null = null;
  if (opts.poller !== false) {
    engineTimer = setInterval(() => {
      runEngineTick().catch(() => {});
    }, opts.ingestorTickMs ?? 60_000);
    engineTimer.unref();
    // Keep the first request responsive after a restart. Ingestor work can
    // start shortly after the RSS poller's delayed initial pass.
    engineStartupTimer = setTimeout(() => {
      engineStartupTimer = null;
      runEngineTick().catch(() => {});
    }, Math.min(BACKGROUND_START_DELAY_MS, opts.ingestorTickMs ?? 60_000));
    engineStartupTimer.unref();
  }

  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    const text = (body as string).trim();
    if (text === "") return done(null, undefined);
    try {
      done(null, JSON.parse(text));
    } catch {
      const err = new Error("invalid JSON body") as Error & { statusCode: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  });
  registerRoutes(app, storage, poller);
  registerIngestorRoutes(app, storage, engine, llm !== null);
  registerListRoutes(app, storage);
  registerAuthRoutes(app, storage);
  registerPodcastRoutes(app, storage);
  // READER_PODPING=off disables Podping; READER_PODPING_URL picks another relay.
  const realtime = new RealtimeHub(storage, poller, {
    podpingUrl: opts.podpingUrl !== undefined ? opts.podpingUrl
      : process.env.READER_PODPING === "off" ? null : process.env.READER_PODPING_URL ?? DEFAULT_PODPING_URL,
  });
  if (opts.poller !== false) realtime.start();
  app.get("/api/v1/realtime", async () => realtime.status());
  const webDist = process.env.READER_WEB_DIST;
  if (webDist) {
    const { default: fastifyStatic } = await import("@fastify/static");
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) {
        return reply.code(404).send({ error: { code: "not_found", message: "not found" } });
      }
      return reply.sendFile("index.html");
    });
  }
  app.addHook("onClose", async () => {
    if (engineTimer) clearInterval(engineTimer);
    if (engineStartupTimer) clearTimeout(engineStartupTimer);
    poller.stop();
    realtime.stop();
    storage.close();
  });
  return app;
}
