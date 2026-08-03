import Fastify, { type FastifyInstance } from "fastify";
import { createSqliteStorage } from "../storage/sqlite.js";
import { Poller } from "../poller/poller.js";
import { registerRoutes } from "./routes.js";
import { registerIngestorRoutes } from "./routes-ingestors.js";
import { IngestorEngine, type FetchFn } from "../ingestors/engine.js";
import { createOpenRouterClient, type LlmClient } from "../llm/client.js";

export interface ServerOptions {
  dbPath: string;
  poller?: boolean;
  tickMs?: number;
  ingestorAdapters?: Record<string, FetchFn>;
  llm?: LlmClient | null;
  ingestorTickMs?: number;
}

export async function createServer(opts: ServerOptions): Promise<FastifyInstance> {
  const storage = createSqliteStorage(opts.dbPath);
  const poller = new Poller(storage, opts.tickMs !== undefined ? { tickMs: opts.tickMs } : {});
  if (opts.poller !== false) poller.start();

  const llm = opts.llm !== undefined ? opts.llm
    : process.env.OPENROUTER_API_KEY
      ? createOpenRouterClient({ apiKey: process.env.OPENROUTER_API_KEY, model: process.env.READER_LLM_MODEL ?? "google/gemini-2.0-flash-001" })
      : null;
  const engine = new IngestorEngine(storage, llm, opts.ingestorAdapters);
  let engineTicking = false;
  const runEngineTick = async () => {
    if (engineTicking) return;
    engineTicking = true;
    try {
      await engine.tick();
    } catch {
    } finally {
      engineTicking = false;
    }
  };
  let engineTimer: NodeJS.Timeout | null = null;
  if (opts.poller !== false) {
    engineTimer = setInterval(() => {
      runEngineTick().catch(() => {});
    }, opts.ingestorTickMs ?? 60_000);
    engineTimer.unref();
    runEngineTick().catch(() => {});
  }

  const app = Fastify({ logger: true });
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
    poller.stop();
    storage.close();
  });
  return app;
}
