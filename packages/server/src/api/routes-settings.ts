import type { FastifyInstance } from "fastify";
import type { Storage } from "../storage/types.js";

export function registerSettingsRoutes(app: FastifyInstance, storage: Storage): void {
  const userId = () => storage.getOrCreateLocalUser().id;

  app.get("/api/v1/settings", async () => storage.getSettings(userId()));

  app.patch<{ Body: { libbySyncEnabled?: unknown } }>("/api/v1/settings", async (req, reply) => {
    const { libbySyncEnabled } = req.body ?? {};
    if (libbySyncEnabled !== undefined && typeof libbySyncEnabled !== "boolean") {
      return reply.code(400).send({ error: { code: "invalid_setting", message: "libbySyncEnabled must be true or false" } });
    }
    return storage.updateSettings(userId(), { ...(libbySyncEnabled !== undefined ? { libbySyncEnabled } : {}) });
  });
}
