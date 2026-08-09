import { fetchCapped } from "../fetch.js";
import type { IngestorAdapter } from "./types.js";

const PUBLIC_API = "https://public.api.bsky.app";
const AUTH_API = "https://bsky.social";

interface SessionCacheEntry {
  token: string;
  expiresAt: number;
}

const sessionCache = new Map<string, SessionCacheEntry>();

function decodeJwtExpiry(jwt: string): number | null {
  const payload = jwt.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: number };
    return typeof claims.exp === "number" ? claims.exp * 1000 : null;
  } catch {
    return null;
  }
}

function pruneExpired(cache: Map<string, { expiresAt: number }>): void {
  const now = Date.now();
  for (const [key, entry] of cache) if (entry.expiresAt <= now) cache.delete(key);
}

function credentials(config: Record<string, unknown>): { identifier: string; appPassword: string } | null {
  const identifier = (config.identifier as string) ?? process.env.BLUESKY_IDENTIFIER;
  const appPassword = (config.appPassword as string) ?? process.env.BLUESKY_APP_PASSWORD;
  return identifier && appPassword ? { identifier, appPassword } : null;
}

async function getSession(config: Record<string, unknown>, authBase: string, cacheKey: string, force: boolean): Promise<string> {
  const creds = credentials(config)!;
  const hit = sessionCache.get(cacheKey);
  if (!force && hit && hit.expiresAt > Date.now() + 60_000) return hit.token;
  const res = await fetch(`${authBase}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: creds.identifier, password: creds.appPassword }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`bluesky auth failed: HTTP ${res.status}`);
  const data = (await res.json()) as { accessJwt: string };
  // Cache to just under the token's real expiry; a 401 still forces re-auth if
  // the estimate is wrong. Fall back to 100 min when the JWT carries no exp.
  const exp = decodeJwtExpiry(data.accessJwt);
  const expiresAt = exp ? exp - 60_000 : Date.now() + 100 * 60_000;
  pruneExpired(sessionCache);
  sessionCache.set(cacheKey, { token: data.accessJwt, expiresAt });
  return data.accessJwt;
}

function parseItems(body: string) {
  const data = JSON.parse(body) as { feed?: { post: Record<string, unknown> }[]; posts?: Record<string, unknown>[]; cursor?: string };
  const posts = data.feed ? data.feed.map((f) => f.post) : (data.posts ?? []);
  const items = posts.map((p) => {
    const uri = String(p.uri);
    const rkey = uri.split("/").pop() ?? "";
    const author = ((p.author as Record<string, unknown>)?.handle as string) ?? null;
    const record = p.record as Record<string, unknown>;
    return {
      externalId: uri,
      author,
      title: null,
      text: String(record?.text ?? ""),
      url: author && rkey ? `https://bsky.app/profile/${author}/post/${rkey}` : null,
      publishedAt: (record?.createdAt as string) ?? null,
    };
  });
  return { items, cursor: { cursor: data.cursor ?? null } };
}

export const blueskyAdapter: IngestorAdapter = {
  async validate(config) {
    if (!config.handle && !config.search) throw new Error("bluesky config requires handle or search");
    return config.handle ? `Bluesky @${config.handle}` : `Bluesky "${config.search}"`;
  },
  async fetch(config, cursor) {
    const params = new URLSearchParams({ limit: "30" });
    if (cursor?.cursor) params.set("cursor", String(cursor.cursor));
    const path = config.handle
      ? `/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(String(config.handle))}&${params}`
      : `/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(String(config.search))}&${params}`;
    const creds = credentials(config);
    if (!creds) {
      const base = (config._baseUrl as string) ?? PUBLIC_API;
      const res = await fetchCapped(`${base}${path}`, { maxBytes: 5 * 1024 * 1024 });
      if (res.status !== 200) throw new Error(`bluesky fetch failed: HTTP ${res.status}`);
      return parseItems(res.body);
    }
    const authBase = (config._authBase as string) ?? AUTH_API;
    const base = (config._baseUrl as string) ?? AUTH_API;
    const cacheKey = (config._cacheKey as string) ?? creds.identifier;
    let token = await getSession(config, authBase, cacheKey, false);
    let res = await fetchCapped(`${base}${path}`, { maxBytes: 5 * 1024 * 1024, headers: { authorization: `Bearer ${token}` } });
    if (res.status === 401) {
      token = await getSession(config, authBase, cacheKey, true);
      res = await fetchCapped(`${base}${path}`, { maxBytes: 5 * 1024 * 1024, headers: { authorization: `Bearer ${token}` } });
    }
    if (res.status !== 200) throw new Error(`bluesky fetch failed: HTTP ${res.status}`);
    return parseItems(res.body);
  },
};
