import { fetchCapped } from "../fetch.js";
import type { IngestorAdapter } from "./types.js";

function stripHtml(html: string): string {
  return html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>\s*<p>/gi, "\n\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

function base(cfg: Record<string, unknown>): string {
  return (cfg._baseUrl as string) ?? `https://${cfg.instance}`;
}

export const mastodonAdapter: IngestorAdapter = {
  async validate(config) {
    if (!config.instance) throw new Error("mastodon config requires instance");
    if (!config.tag && !config.account) throw new Error("mastodon config requires tag or account");
    const res = await fetchCapped(`${base(config)}/api/v1/instance`, { maxBytes: 1024 * 1024 });
    if (res.status !== 200) throw new Error(`mastodon instance unreachable: HTTP ${res.status}`);
    const label = config.tag ? `#${config.tag}` : String(config.account);
    return `Mastodon ${label}@${config.instance}`;
  },
  async fetch(config, cursor) {
    const maxId = cursor?.maxId as string | undefined;
    const params = new URLSearchParams({ limit: "40" });
    if (maxId) params.set("max_id", maxId);
    const path = config.tag
      ? `/api/v1/timelines/tag/${encodeURIComponent(String(config.tag))}`
      : `/api/v1/accounts/${encodeURIComponent(String(config.account))}/statuses`;
    const res = await fetchCapped(`${base(config)}${path}?${params}`, { maxBytes: 5 * 1024 * 1024 });
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
    const last = statuses[statuses.length - 1];
    return { items, cursor: { maxId: last ? String(last.id) : maxId ?? null } };
  },
};
