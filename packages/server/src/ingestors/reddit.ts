import { fetchCapped } from "../fetch.js";
import type { IngestorAdapter } from "./types.js";

interface TokenEntry { token: string; expiresAt: number }
const tokenCache = new Map<string, TokenEntry>();

function redditCreds(config: Record<string, unknown>): { clientId: string; clientSecret: string; username?: string; password?: string } | null {
  const clientId = (config.clientId as string) ?? process.env.REDDIT_CLIENT_ID;
  const clientSecret = (config.clientSecret as string) ?? process.env.REDDIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const username = (config.username as string) ?? process.env.REDDIT_USERNAME;
  const password = (config.password as string) ?? process.env.REDDIT_PASSWORD;
  return { clientId, clientSecret, ...(username && password ? { username, password } : {}) };
}

async function getToken(config: Record<string, unknown>, tokenBase: string, cacheKey: string): Promise<string> {
  const creds = redditCreds(config)!;
  const hit = tokenCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;
  const body = new URLSearchParams(
    creds.username
      ? { grant_type: "password", username: creds.username, password: creds.password! }
      : { grant_type: "client_credentials" },
  );
  const res = await fetch(`${tokenBase}/api/v1/access_token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64")}`,
      "user-agent": "reader/0.1 (feed reader)",
    },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`reddit auth failed: HTTP ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache.set(cacheKey, { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 120) * 1000 });
  return data.access_token;
}

export const redditAdapter: IngestorAdapter = {
  async validate(config) {
    if (!config.subreddit) throw new Error("reddit config requires subreddit");
    return `r/${config.subreddit}`;
  },
  async fetch(config, cursor) {
    const creds = redditCreds(config);
    let base = (config._baseUrl as string) ?? "https://www.reddit.com";
    const headers: Record<string, string> = { "user-agent": "reader/0.1 (feed reader)" };
    if (creds) {
      const cacheKey = (config._cacheKey as string) ?? creds.clientId;
      const tokenBase = (config._tokenBase as string) ?? "https://www.reddit.com";
      const token = await getToken(config, tokenBase, cacheKey);
      base = (config._oauthBase as string) ?? "https://oauth.reddit.com";
      headers.authorization = `Bearer ${token}`;
    }
    const sort = (config.sort as string) ?? "new";
    const params = new URLSearchParams({ limit: "25" });
    if (cursor?.after) params.set("after", String(cursor.after));
    const res = await fetchCapped(
      `${base}/r/${encodeURIComponent(String(config.subreddit))}/${sort}.json?${params}`,
      { maxBytes: 5 * 1024 * 1024, headers },
    );
    if (res.status !== 200) throw new Error(`reddit fetch failed: HTTP ${res.status}`);
    const listing = JSON.parse(res.body) as { data: { children: { data: Record<string, unknown> }[]; after: string | null } };
    const items = listing.data.children.map((c) => {
      const d = c.data;
      const selftext = String(d.selftext ?? "");
      const linkUrl = String(d.url ?? "");
      const permalink = `https://www.reddit.com${d.permalink}`;
      return {
        externalId: String(d.name),
        author: (d.author as string) ?? null,
        title: String(d.title ?? ""),
        text: selftext || linkUrl || String(d.title ?? ""),
        url: d.is_self ? permalink : linkUrl || permalink,
        publishedAt: d.created_utc ? new Date(Number(d.created_utc) * 1000).toISOString() : null,
      };
    });
    return { items, cursor: { after: listing.data.after } };
  },
};
