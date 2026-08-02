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
  registerRoutes(app, storage, poller);
  app.addHook("onClose", async () => {
    poller.stop();
    storage.close();
  });
  return app;
}
