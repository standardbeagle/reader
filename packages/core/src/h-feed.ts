import { createHash } from "node:crypto";
import { mf2 } from "microformats-parser";
import type { ArticleMedia, ParsedArticle, ParsedFeed } from "./types.js";
import { limitCategories } from "./categories.js";
import { titleFromText } from "./content.js";

interface Mf2Item {
  type?: string[];
  properties?: Record<string, unknown[]>;
  children?: Mf2Item[];
  value?: unknown;
}

const MAX_ENTRIES = 200;

/** A property's first value as text: plain strings, or the value/name of a nested object. */
function text(item: Mf2Item, name: string): string | null {
  const v = item.properties?.[name]?.[0];
  if (typeof v === "string") return v.trim() || null;
  if (v && typeof v === "object") {
    const o = v as { value?: unknown; properties?: Record<string, unknown[]> };
    const nested = o.properties?.name?.[0];
    if (typeof nested === "string" && nested.trim()) return nested.trim();
    if (typeof o.value === "string" && o.value.trim()) return o.value.trim();
  }
  return null;
}

function allText(item: Mf2Item, name: string): string[] {
  return (item.properties?.[name] ?? []).map((v) => (typeof v === "string" ? v : typeof (v as { value?: unknown })?.value === "string" ? (v as { value: string }).value : null))
    .filter((v): v is string => Boolean(v?.trim()));
}

function contentOf(item: Mf2Item): { html: string | null; text: string | null } {
  for (const v of item.properties?.content ?? []) {
    if (v && typeof v === "object" && typeof (v as { html?: unknown }).html === "string") {
      const o = v as { html: string; value?: string };
      return { html: o.html.trim() || null, text: o.value?.trim() || null };
    }
  }
  const plain = text(item, "content");
  return { html: null, text: plain };
}

function isType(item: Mf2Item, type: string): boolean {
  return item.type?.includes(type) ?? false;
}

/** h-entry items anywhere under the page's roots, not counting entries quoted inside entries. */
function entriesIn(items: Mf2Item[], out: Mf2Item[] = []): Mf2Item[] {
  for (const item of items) {
    if (out.length >= MAX_ENTRIES) break;
    if (isType(item, "h-entry")) out.push(item);
    else entriesIn(item.children ?? [], out);
  }
  return out;
}

function playable(item: Mf2Item): ArticleMedia | null {
  const audio = text(item, "audio");
  if (audio) return { url: audio, type: null };
  const video = text(item, "video");
  return video ? { url: video, type: null } : null;
}

/**
 * Parse an IndieWeb h-feed: an HTML page whose posts are marked up as
 * h-entry microformats (https://microformats.org/wiki/h-feed). `pageUrl`
 * resolves relative links. A page with no h-entry is not a feed.
 */
export function parseHFeed(html: string, pageUrl: string): ParsedFeed {
  const doc = mf2(html, { baseUrl: pageUrl }) as { items: Mf2Item[] };
  const feed = doc.items.find((i) => isType(i, "h-feed")) ?? null;
  const entries = entriesIn(doc.items);
  if (entries.length === 0) throw new Error("HTML page has no h-entry items");
  const feedAuthor = feed ? text(feed, "author") : null;
  const articles: ParsedArticle[] = entries.map((entry) => {
    const content = contentOf(entry);
    const name = text(entry, "name");
    const url = text(entry, "url");
    const published = text(entry, "published") ?? text(entry, "updated");
    const date = published ? new Date(published) : null;
    // mf2 implies a name from the whole entry's text when none is marked up;
    // that is the content again, so treat it as untitled.
    const title = name && name !== content.text ? name : titleFromText(content.text ?? text(entry, "summary")) ?? "(untitled)";
    const uid = text(entry, "uid") ?? url
      ?? `sha1:${createHash("sha1").update(`${title}|${published ?? ""}|${content.text ?? ""}`).digest("hex")}`;
    return {
      guid: uid,
      url,
      title,
      author: text(entry, "author") ?? feedAuthor,
      publishedAt: date && !Number.isNaN(date.getTime()) ? date : null,
      contentHtml: content.html ?? content.text,
      summary: text(entry, "summary"),
      imageUrl: text(entry, "photo") ?? text(entry, "featured"),
      categories: limitCategories(allText(entry, "category")),
      media: playable(entry),
    };
  });
  const pageTitle = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim();
  return {
    title: (feed && text(feed, "name")) ?? pageTitle ?? new URL(pageUrl).host,
    siteUrl: (feed && text(feed, "url")) ?? pageUrl,
    articles,
  };
}
