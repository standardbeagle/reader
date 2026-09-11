import type { FastifyInstance } from "fastify";
import { parseChapters, parseTranscript } from "@reader/core";
import type { Storage } from "../storage/types.js";
import { fetchCapped } from "../fetch.js";

const MAX_TRANSCRIPT_BYTES = 4 * 1024 * 1024;
const MAX_CHAPTERS_BYTES = 512 * 1024;

/**
 * Podcasting 2.0 extras, fetched on demand when the reader opens them. The
 * server fetches (behind the SSRF guard and byte caps) and normalizes, so the
 * browser never parses a publisher's file and needs no CORS from its host.
 * Feed credentials are not sent: these files live on other hosts.
 */
export function registerPodcastRoutes(app: FastifyInstance, storage: Storage): void {
  const userId = () => storage.getOrCreateLocalUser().id;

  app.get<{ Params: { id: string } }>("/api/v1/articles/:id/transcript", async (req, reply) => {
    const transcript = storage.getArticle(userId(), req.params.id)?.transcript;
    if (!transcript) return reply.code(404).send({ error: { code: "not_found", message: "this episode has no transcript" } });
    try {
      const res = await fetchCapped(transcript.url, { maxBytes: MAX_TRANSCRIPT_BYTES });
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      return parseTranscript(res.body, transcript.type ?? res.headers.get("content-type")?.split(";")[0]?.trim() ?? null);
    } catch (e) {
      return reply.code(502).send({ error: { code: "transcript_unavailable", message: e instanceof Error ? e.message : String(e) } });
    }
  });

  app.get<{ Params: { id: string } }>("/api/v1/articles/:id/chapters", async (req, reply) => {
    const url = storage.getArticle(userId(), req.params.id)?.chaptersUrl;
    if (!url) return reply.code(404).send({ error: { code: "not_found", message: "this episode has no chapters" } });
    try {
      const res = await fetchCapped(url, { maxBytes: MAX_CHAPTERS_BYTES });
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      return { chapters: parseChapters(res.body) };
    } catch (e) {
      return reply.code(502).send({ error: { code: "chapters_unavailable", message: e instanceof Error ? e.message : String(e) } });
    }
  });
}
