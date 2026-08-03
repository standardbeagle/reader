import { fetchCapped } from "../fetch.js";
import type { IngestorAdapter } from "./types.js";

const PUBLIC_API = "https://public.api.bsky.app";

export const blueskyAdapter: IngestorAdapter = {
  async validate(config) {
    if (!config.handle && !config.search) throw new Error("bluesky config requires handle or search");
    return config.handle ? `Bluesky @${config.handle}` : `Bluesky "${config.search}"`;
  },
  async fetch(config, cursor) {
    const base = (config._baseUrl as string) ?? PUBLIC_API;
    const params = new URLSearchParams({ limit: "30" });
    if (cursor?.cursor) params.set("cursor", String(cursor.cursor));
    const path = config.handle
      ? `/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(String(config.handle))}&${params}`
      : `/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(String(config.search))}&${params}`;
    const res = await fetchCapped(`${base}${path}`, { maxBytes: 5 * 1024 * 1024 });
    if (res.status !== 200) throw new Error(`bluesky fetch failed: HTTP ${res.status}`);
    const data = JSON.parse(res.body) as { feed?: { post: Record<string, unknown> }[]; posts?: Record<string, unknown>[]; cursor?: string };
    const posts = data.feed ? data.feed.map((f) => f.post) : (data.posts ?? []);
    const items = posts.map((p) => {
      const uri = String(p.uri);
      const rkey = uri.split("/").pop() ?? "";
      const author = (p.author as Record<string, unknown>)?.handle as string ?? null;
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
  },
};
