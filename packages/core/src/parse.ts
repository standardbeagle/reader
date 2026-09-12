import Parser from "rss-parser";
import { createHash } from "node:crypto";
import type { ArticleMedia, ParsedFeed, ParsedArticle } from "./types.js";
import { decodeHtmlEntities, isHtmlDocument, looksLikeHtml } from "./content.js";
import { parseHFeed } from "./h-feed.js";
import { limitCategories } from "./categories.js";
import { parseJsonFeed } from "./json-feed.js";

const parser = new Parser({
  customFields: {
    // Feed-level links: RSS carries them as atom:link, Atom as link. rss-parser
    // accepts [field, key, options] for feeds at runtime, but its typings only
    // declare plain names.
    feed: [
      "ttl", "sy:updatePeriod", "sy:updateFrequency",
      ["atom:link", "atomLinks", { keepArray: true }],
      ["link", "links", { keepArray: true }],
    ] as unknown as string[],
    item: [
      ["media:thumbnail", "media:thumbnail", { keepArray: true }],
      ["media:content", "media:content", { keepArray: true }],
      ["media:group", "media:group"],
      ["podcast:transcript", "podcast:transcript", { keepArray: true }],
      ["podcast:chapters", "podcast:chapters"],
      // Atom <category> elements carry the subject in attributes; without this
      // custom field some Atom feeds lose categories entirely.
      ["category", "category", { keepArray: true }],
    ],
  },
});

type MediaKind = "image" | "playable" | "unknown";

const PLAYABLE_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|mp4|m4v|mov|webm)(\?|$)/i;
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif)(\?|$)/i;

function attrsOf(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const object = value as Record<string, unknown>;
  return (object.$ && typeof object.$ === "object" ? object.$ : object) as Record<string, unknown>;
}

/** What an enclosure or media:content points at, from its type, medium or extension. */
function mediaKind(value: unknown): MediaKind {
  const attrs = attrsOf(value);
  const type = String(attrs.type ?? "").toLowerCase();
  const medium = String(attrs.medium ?? "").toLowerCase();
  const url = String(attrs.url ?? "");
  if (type.startsWith("image/") || medium === "image" || (!type && IMAGE_EXT.test(url))) return "image";
  if (/^(audio|video)\//.test(type) || medium === "audio" || medium === "video" || (!type && PLAYABLE_EXT.test(url))) return "playable";
  return "unknown";
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value ? [value] : [];
}

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

/**
 * The article's picture. Enclosures and media:content only count when they
 * are images — a podcast's mp3 enclosure is not a hero image. Episode art
 * (itunes:image) comes next, then the show's art.
 */
function imageUrl(item: Record<string, unknown>, showArt: string | null): string | null {
  const enclosure = listOf(item.enclosure).find((e) => mediaKind(e) === "image");
  const content = listOf(item["media:content"]).find((e) => mediaKind(e) !== "playable");
  const itunes = (item.itunes as Record<string, unknown> | undefined)?.image;
  return firstMediaUrl(enclosure)
    ?? firstMediaUrl(item["media:thumbnail"])
    ?? firstMediaUrl(content)
    ?? firstMediaUrl(mediaGroup(item)?.["media:thumbnail"])
    ?? (typeof itunes === "string" && itunes.trim() ? itunes.trim() : null)
    ?? showArt;
}

function playableMedia(item: Record<string, unknown>): ArticleMedia | null {
  const candidate = [...listOf(item.enclosure), ...listOf(item["media:content"])].find((e) => mediaKind(e) === "playable");
  const url = firstMediaUrl(candidate);
  if (!url) return null;
  const type = String(attrsOf(candidate).type ?? "").trim();
  return { url, type: type || null };
}

// Best first: timed formats let the reader seek the player to a line.
const TRANSCRIPT_PREFERENCE = ["text/vtt", "application/x-subrip", "application/srt", "application/json", "text/html", "text/plain"];

function bestTranscript(item: Record<string, unknown>): ArticleMedia | null {
  const offered = listOf(item["podcast:transcript"]).map(attrsOf)
    .filter((a) => typeof a.url === "string" && a.url.trim())
    .map((a) => ({ url: String(a.url).trim(), type: String(a.type ?? "").trim().toLowerCase() || null }));
  const rank = (t: ArticleMedia) => {
    const i = t.type ? TRANSCRIPT_PREFERENCE.indexOf(t.type) : -1;
    return i === -1 ? TRANSCRIPT_PREFERENCE.length : i;
  };
  return offered.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

function chaptersUrl(item: Record<string, unknown>): string | null {
  const url = attrsOf(listOf(item["podcast:chapters"])[0]).url;
  return typeof url === "string" && url.trim() ? url.trim() : null;
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

/**
 * RFC 5005: a paged feed's rel="next" leads to older entries; an archived
 * feed's rel="prev-archive" to the previous archive document. Paging wins
 * when both are present because it is the finer-grained walk.
 */
function olderUrl(feed: Record<string, unknown>): string | null {
  const links = [...listOf(feed.atomLinks), ...listOf(feed.links)].map(attrsOf);
  const href = (rel: string) => {
    const hit = links.find((l) => String(l.rel ?? "").toLowerCase() === rel && typeof l.href === "string" && l.href.trim());
    return hit ? String(hit.href).trim() : null;
  };
  return href("next") ?? href("prev-archive");
}

// The transitive XML stack does not expand custom entities today, but a DOCTYPE
// internal subset is the XXE / billion-laughs vector — reject it explicitly so a
// future parser or option change cannot silently reintroduce the exposure. The
// char cap bounds parse work independently of the byte cap enforced at fetch.
const MAX_FEED_CHARS = 8 * 1024 * 1024;
const DOCTYPE_SUBSET = /<!DOCTYPE[^>[]*\[/i;

/**
 * Parse RSS, Atom, JSON Feed, or an h-feed HTML page. `url` is where the
 * document came from; HTML needs it to resolve relative links.
 */
export async function parseFeed(xml: string, opts: { url?: string } = {}): Promise<ParsedFeed> {
  if (xml.length > MAX_FEED_CHARS) throw new Error("feed too large to parse");
  // JSON Feed documents are objects; nothing XML-shaped starts with "{".
  const body = xml.replace(/^\uFEFF/, "").trimStart();
  if (body.startsWith("{")) return parseJsonFeed(body);
  if (isHtmlDocument(body)) {
    if (!opts.url) throw new Error("an HTML page needs its URL to be read as an h-feed");
    return parseHFeed(body, opts.url);
  }
  if (DOCTYPE_SUBSET.test(xml)) throw new Error("feed contains a DOCTYPE internal subset");
  const raw = await parser.parseString(xml);
  const showImage = (raw as unknown as { itunes?: { image?: unknown } }).itunes?.image;
  const showArt = typeof showImage === "string" && showImage.trim() ? showImage.trim() : null;
  const articles: ParsedArticle[] = (raw.items ?? []).map((item) => {
    const it = item as unknown as Record<string, unknown>;
    // Titles are plain text, but publishers often put entities inside CDATA
    // (The Verge: <![CDATA[it&#8217;s]]>), which XML leaves as literal "&#8217;".
    const title = typeof it.title === "string" ? decodeHtmlEntities(it.title.trim()) || "(untitled)" : "(untitled)";
    const url = typeof it.link === "string" ? it.link : null;
    const published = typeof it.isoDate === "string" ? it.isoDate : typeof it.pubDate === "string" ? it.pubDate : null;
    const parsedDate = published ? new Date(published) : null;
    const explicitGuid = typeof it.guid === "string" ? it.guid : typeof it.id === "string" ? it.id : null;
    // Identity, most stable field first. RSS treats the link as the permalink
    // when an item carries no guid, and it is the only field publishers do not
    // quietly rewrite: science.org re-stamps pubDate by 10-60 seconds and
    // copy-edits titles between polls ("river" to "River", straight quotes to
    // curly), so either one in the identity turns an edit into a second copy.
    // Two guid-less items sharing a link therefore read as one item.
    //
    // The last-resort hash keeps its input string byte for byte, empty leading
    // url field included: changing it would orphan every row stored under it.
    const guid = explicitGuid ?? url
      ?? `sha1:${createHash("sha1").update(`|${title}|${published ?? ""}`).digest("hex")}`;
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
      imageUrl: imageUrl(it, showArt),
      categories: articleCategories(it),
      media: playableMedia(it),
      transcript: bestTranscript(it),
      chaptersUrl: chaptersUrl(it),
    };
  });
  return {
    title: raw.title?.trim() || "(untitled feed)",
    siteUrl: raw.link ?? null,
    articles,
    updateHintMinutes: updateHintMinutes(raw as unknown as Record<string, unknown>),
    olderUrl: olderUrl(raw as unknown as Record<string, unknown>),
  };
}
