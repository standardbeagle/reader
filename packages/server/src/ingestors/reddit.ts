import { fetchCapped } from "../fetch.js";
import type { IngestorAdapter } from "./types.js";

export const redditAdapter: IngestorAdapter = {
  async validate(config) {
    if (!config.subreddit) throw new Error("reddit config requires subreddit");
    return `r/${config.subreddit}`;
  },
  async fetch(config, cursor) {
    const base = (config._baseUrl as string) ?? "https://www.reddit.com";
    const sort = (config.sort as string) ?? "new";
    const params = new URLSearchParams({ limit: "25" });
    if (cursor?.after) params.set("after", String(cursor.after));
    const res = await fetchCapped(
      `${base}/r/${encodeURIComponent(String(config.subreddit))}/${sort}.json?${params}`,
      { maxBytes: 5 * 1024 * 1024, headers: { "user-agent": "reader/0.1 (feed reader)" } },
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
