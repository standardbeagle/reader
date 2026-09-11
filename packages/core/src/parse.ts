import Parser from "rss-parser";
import { createHash } from "node:crypto";
import type { ParsedFeed, ParsedArticle } from "./types.js";
import { looksLikeHtml } from "./content.js";
import { limitCategories } from "./categories.js";
import { parseJsonFeed } from "./json-feed.js";

const parser = new Parser({
  customFields: {
    feed: ["ttl", "sy:updatePeriod", "sy:updateFrequency"],
    item: [
      ["media:thumbnail", "media:thumbnail", { keepArray: true }],
      ["media:content", "media:content", { keepArray: true }],
      ["media:group", "media:group"],
      // Atom <category> elements carry the subject in attributes; without this
      // custom field some Atom feeds lose categories entirely.
      ["category", "category", { keepArray: true }],
    ],
  },
});

function firstMediaUrl(value: unknown): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate === "string") return candidate.trim() || null;
  if (!candidate || typeof candidate !== "object") return null;
  const object = candidate as Record<string, unknown>;
  const attributes = object.$;
  if (attributes && typeof attributes === "object") {
    const url = (attributes as Record<string, unknown>).url;
    if (typeof url === "string" && url.trim()) return url.trim();
  }
  const url = object.url;
  return typeof url === "string" && url.trim() ? url.trim() : null;
}

// Media RSS allows media:* elements inside a <media:group>. YouTube puts every
// entry's thumbnail and description there, and its group media:content is a
// player URL, not an image — so only the group's thumbnail is used.
function mediaGroup(item: Record<string, unknown>): Record<string, unknown> | null {
  const group = item["media:group"];
  return group && typeof group === "object" ? group as Record<string, unknown> : null;
}

function mediaUrl(item: Record<string, unknown>): string | null {
  return firstMediaUrl(item.enclosure)
    ?? firstMediaUrl(item["media:thumbnail"])
    ?? firstMediaUrl(item["media:content"])
    ?? firstMediaUrl(mediaGroup(item)?.["media:thumbnail"]);
}

function mediaDescription(item: Record<string, unknown>): string | null {
  const raw = mediaGroup(item)?.["media:description"];
  const text = Array.isArray(raw) ? raw[0] : raw;
  return typeof text === "string" && text.trim() ? text.trim() : null;
}

// RSS <category> maps to strings; Atom <category term="x"> maps to objects.
function articleCategories(item: Record<string, unknown>): string[] {
  const raw = item.categories ?? item.category;
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return limitCategories(values.map((value) => {
    if (typeof value === "string") return value;
    if (!value || typeof value !== "object") return null;
    const attributes = (value as Record<string, unknown>).$ as Record<string, unknown> | undefined;
    const term = (attributes?.term ?? attributes?.label ?? (value as Record<string, unknown>).term) as unknown;
    return typeof term === "string" ? term : null;
  }));
}

const SY_PERIOD_MINUTES: Record<string, number> = {
  hourly: 60, daily: 1440, weekly: 10_080, monthly: 43_200, yearly: 525_600,
};

/**
 * RSS <ttl> is minutes to cache; the syndication module says "updates N times
 * per period". Either is the publisher asking not to be polled more often.
 */
function updateHintMinutes(feed: Record<string, unknown>): number | null {
  const ttl = Number(String(feed.ttl ?? "").trim());
  if (Number.isFinite(ttl) && ttl > 0) return ttl;
  const period = SY_PERIOD_MINUTES[String(feed["sy:updatePeriod"] ?? "").trim().toLowerCase()];
  if (!period) return null;
  const frequency = Number(String(feed["sy:updateFrequency"] ?? "1").trim()) || 1;
  return period / Math.max(1, frequency);
}

// The transitive XML stack does not expand custom entities today, but a DOCTYPE
// internal subset is the XXE / billion-laughs vector — reject it explicitly so a
// future parser or option change cannot silently reintroduce the exposure. The
// char cap bounds parse work independently of the byte cap enforced at fetch.
const MAX_FEED_CHARS = 8 * 1024 * 1024;
const DOCTYPE_SUBSET = /<!DOCTYPE[^>[]*\[/i;

export async function parseFeed(xml: string): Promise<ParsedFeed> {
  if (xml.length > MAX_FEED_CHARS) throw new Error("feed too large to parse");
  // JSON Feed documents are objects; nothing XML-shaped starts with "{".
  const body = xml.replace(/^\uFEFF/, "").trimStart();
  if (body.startsWith("{")) return parseJsonFeed(body);
  if (DOCTYPE_SUBSET.test(xml)) throw new Error("feed contains a DOCTYPE internal subset");
  const raw = await parser.parseString(xml);
  const articles: ParsedArticle[] = (raw.items ?? []).map((item) => {
    const it = item as unknown as Record<string, unknown>;
    const title = typeof it.title === "string" ? it.title.trim() || "(untitled)" : "(untitled)";
    const url = typeof it.link === "string" ? it.link : null;
    const published = typeof it.isoDate === "string" ? it.isoDate : typeof it.pubDate === "string" ? it.pubDate : null;
    const parsedDate = published ? new Date(published) : null;
    const explicitGuid = typeof it.guid === "string" ? it.guid : typeof it.id === "string" ? it.id : null;
    const guid = explicitGuid
      ?? `sha1:${createHash("sha1").update(`${url ?? ""}|${title}|${published ?? ""}`).digest("hex")}`;
    const rawContent = typeof it["content:encoded"] === "string"
      ? it["content:encoded"]
      : typeof it.content === "string" ? it.content : null;
    const rawSummary = typeof it.summary === "string"
      ? it.summary
      : typeof it.contentSnippet === "string" ? it.contentSnippet : mediaDescription(it);
    const contentHtml = rawContent ?? (looksLikeHtml(rawSummary) ? rawSummary : null);
    return {
      guid,
      url,
      title,
      author: typeof it.creator === "string" ? it.creator : typeof it.author === "string" ? it.author : null,
      publishedAt: parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate : null,
      contentHtml,
      summary: rawContent ? rawSummary : contentHtml ? null : rawSummary,
      imageUrl: mediaUrl(it),
      categories: articleCategories(it),
    };
  });
  return {
    title: raw.title?.trim() || "(untitled feed)",
    siteUrl: raw.link ?? null,
    articles,
    updateHintMinutes: updateHintMinutes(raw as unknown as Record<string, unknown>),
  };
}
