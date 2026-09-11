import { fetchCapped } from "../fetch.js";
import { authorizationFor } from "../auth/credentials.js";
import type { AdapterContext, IngestorAdapter } from "./types.js";

function stripHtml(html: string): string {
  return html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>\s*<p>/gi, "\n\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

function base(cfg: Record<string, unknown>): string {
  return (cfg._baseUrl as string) ?? `https://${cfg.instance}`;
}

/** Signed with the connected account when the config names one. */
async function getAuthed(config: Record<string, unknown>, ctx: AdapterContext, url: string, maxBytes: number) {
  const credentialId = config.credentialId as string | undefined;
  return fetchCapped(url, {
    maxBytes,
    ...(credentialId ? { headers: { authorization: await authorizationFor(ctx.storage, credentialId, url) } } : {}),
  });
}

export const mastodonAdapter: IngestorAdapter = {
  async validate(config, ctx) {
    if (!config.instance) throw new Error("mastodon config requires instance");
    const home = config.timeline === "home";
    if (!home && !config.tag && !config.account) throw new Error("mastodon config requires tag, account or timeline: home");
    if (home && !config.credentialId) throw new Error("the home timeline needs a connected Mastodon account");
    if (config.credentialId) {
      const res = await getAuthed(config, ctx, `${base(config)}/api/v1/accounts/verify_credentials`, 256 * 1024);
      if (res.status !== 200) throw new Error(`mastodon account rejected: HTTP ${res.status} — reconnect it`);
      if (home) return `Mastodon home @${String((JSON.parse(res.body) as Record<string, unknown>).acct)}@${config.instance}`;
    } else {
      const res = await fetchCapped(`${base(config)}/api/v1/instance`, { maxBytes: 1024 * 1024 });
      if (res.status !== 200) throw new Error(`mastodon instance unreachable: HTTP ${res.status}`);
    }
    const label = config.tag ? `#${config.tag}` : String(config.account);
    return `Mastodon ${label}@${config.instance}`;
  },
  async fetch(config, cursor, ctx) {
    // min_id returns the page immediately newer than the newest status already
    // seen, so a backlog drains forward 40 at a time with no gap.
    const minId = cursor?.minId as string | undefined;
    const params = new URLSearchParams({ limit: "40" });
    if (minId) params.set("min_id", minId);
    const path = config.timeline === "home"
      ? "/api/v1/timelines/home"
      : config.tag
        ? `/api/v1/timelines/tag/${encodeURIComponent(String(config.tag))}`
        : `/api/v1/accounts/${encodeURIComponent(String(config.account))}/statuses`;
    const res = await getAuthed(config, ctx, `${base(config)}${path}?${params}`, 5 * 1024 * 1024);
    if (res.status !== 200) throw new Error(`mastodon fetch failed: HTTP ${res.status}`);
    const statuses = JSON.parse(res.body) as Record<string, unknown>[];
    const items = statuses.map((s) => ({
      externalId: String(s.id),
      author: (s.account as Record<string, unknown>)?.acct as string ?? null,
      title: null,
      text: stripHtml(String(s.content ?? "")),
      url: (s.url as string) ?? null,
      publishedAt: (s.created_at as string) ?? null,
    }));
    // Status ids are numeric strings of varying length; compare as BigInt.
    const newest = statuses.reduce<string | null>(
      (max, s) => (max === null || BigInt(String(s.id)) > BigInt(max) ? String(s.id) : max),
      minId ?? null,
    );
    return { items, cursor: { minId: newest } };
  },
};
