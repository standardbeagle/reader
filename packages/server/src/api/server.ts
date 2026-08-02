import Fastify, { type FastifyInstance } from "fastify";
import { createSqliteStorage } from "../storage/sqlite.js";
import { Poller } from "../poller/poller.js";
import { registerRoutes } from "./routes.js";

export interface ServerOptions {
  dbPath: string;
  poller?: boolean;
  tickMs?: number;
}

export async function createServer(opts: ServerOptions): Promise<FastifyInstance> {
  const storage = createSqliteStorage(opts.dbPath);
  const poller = new Poller(storage, opts.tickMs !== undefined ? { tickMs: opts.tickMs } : {});
  if (opts.poller !== false) poller.start();

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
    poller.stop();
    storage.close();
  });
  return app;
}
