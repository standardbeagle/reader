import type { FastifyInstance } from "fastify";
import { parseChapters, parseTranscript } from "@reader/core";
import type { Storage } from "../storage/types.js";
import { fetchCapped } from "../fetch.js";
import { frameBlockReason } from "../frame-policy.js";

const MAX_TRANSCRIPT_BYTES = 4 * 1024 * 1024;
const MAX_CHAPTERS_BYTES = 512 * 1024;
const EMBED_CACHE_TTL_MS = 6 * 60 * 60_000;
// A failed check (network error, 5xx) may be transient; retry it soon.
const EMBED_FAILURE_TTL_MS = 5 * 60_000;
const MAX_EMBED_CACHE = 1000;

export interface Embeddability {
  /** false when the page refuses to be framed; null when it could not be checked. */
  embeddable: boolean | null;
  reason: string | null;
}

/**
 * Extras the reader pane asks for on demand: whether the original page can be
 * framed, and Podcasting 2.0 transcripts and chapters. The server fetches
 * (behind the SSRF guard and byte caps) and normalizes, so the browser never
 * parses a publisher's file and needs no CORS from its host. Feed credentials
 * are not sent: these files live on other hosts.
 */
export function registerArticleExtraRoutes(app: FastifyInstance, storage: Storage): void {
  const userId = () => storage.getOrCreateLocalUser().id;
  // Framing policy rarely changes, and an article is opened many times.
  const embedCache = new Map<string, { at: number; result: Embeddability }>();

  // Whether the original page can be shown in the Embedded page tab. Only the
  // browser can load it, and a refused frame is silently blank there, so the
  // server reads the page's X-Frame-Options / CSP frame-ancestors instead.
  app.get<{ Params: { id: string } }>("/api/v1/articles/:id/embeddable", async (req, reply) => {
    const url = storage.getArticle(userId(), req.params.id)?.url;
    if (!url || !/^https?:\/\//.test(url)) return reply.code(404).send({ error: { code: "not_found", message: "article has no page to embed" } });
    const hit = embedCache.get(url);
    if (hit && Date.now() - hit.at < (hit.result.embeddable === null ? EMBED_FAILURE_TTL_MS : EMBED_CACHE_TTL_MS)) return hit.result;
    let result: Embeddability;
    try {
      const res = await fetchCapped(url, { headersOnly: true, timeoutMs: 8_000, headers: { accept: "text/html,*/*" } });
      if (res.status >= 400) {
        result = { embeddable: null, reason: `the page answered HTTP ${res.status}` };
      } else {
        const reason = frameBlockReason(res.headers);
        result = { embeddable: reason === null, reason };
      }
    } catch (e) {
      result = { embeddable: null, reason: e instanceof Error ? e.message : String(e) };
    }
    if (embedCache.size >= MAX_EMBED_CACHE) embedCache.delete(embedCache.keys().next().value!);
    embedCache.set(url, { at: Date.now(), result });
    return result;
  });

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
