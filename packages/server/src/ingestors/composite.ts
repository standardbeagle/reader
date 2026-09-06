import type { AdapterContext, IngestorAdapter } from "./types.js";

const MAX_PER_FEED = 25;
const MAX_TEXT_CHARS = 4000;

function htmlToText(html: string): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ");
  return text.replace(/\s+/g, " ").trim();
}

function itemText(a: { summary: string | null; contentHtml: string | null; title: string }): string {
  const body = a.contentHtml ? htmlToText(a.contentHtml) : a.summary ?? "";
  const text = body || a.title;
  return text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}…` : text;
}

function sourceFeedIds(config: Record<string, unknown>): string[] {
  const raw = config.sourceFeedIds;
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string");
}

export const compositeAdapter: IngestorAdapter = {
  async validate(config) {
    const ids = sourceFeedIds(config);
    if (ids.length === 0) throw new Error("composite config requires at least one sourceFeedIds entry");
    return (config.name as string) || "Combined feeds";
  },
  async fetch(config, cursor, ctx: AdapterContext) {
    const ids = sourceFeedIds(config);
    if (ids.length === 0) throw new Error("composite config requires at least one sourceFeedIds entry");
    const since = typeof cursor?.since === "string" ? (cursor.since as string) : null;
    const items = [];
    let newest: string | null = since;
    for (const feedId of ids) {
      const articles = ctx.storage.listArticles({
        userId: ctx.userId, feedId, limit: MAX_PER_FEED, includeContent: true, includeSnoozed: true,
      });
      for (const a of articles) {
        if (a.publishedAt && (!newest || a.publishedAt > newest)) newest = a.publishedAt;
        if (since && a.publishedAt && a.publishedAt < since) continue;
        if (since && !a.publishedAt) continue;
        items.push({
          externalId: `${feedId}:${a.guid}`,
          author: a.author,
          title: a.title,
          text: itemText(a),
          url: a.url,
          publishedAt: a.publishedAt,
        });
      }
    }
    return { items, cursor: { since: newest } };
  },
};
