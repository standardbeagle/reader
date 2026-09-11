import type { ArticleMedia, ParsedArticle, ParsedFeed } from "./types.js";
import { limitCategories } from "./categories.js";

const UNTITLED_MAX_CHARS = 80;

type Json = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function date(v: unknown): Date | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Microblog items often have no title; use the start of the text instead. */
function titleFrom(item: Json): string {
  const explicit = str(item.title);
  if (explicit) return explicit;
  const firstLine = str(item.content_text)?.split("\n")[0]?.trim() ?? str(item.summary);
  if (!firstLine) return "(untitled)";
  if (firstLine.length <= UNTITLED_MAX_CHARS) return firstLine;
  const cut = firstLine.slice(0, UNTITLED_MAX_CHARS);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : UNTITLED_MAX_CHARS)}…`;
}

/** 1.1 has authors[]; 1.0 had a single author object. */
function authorName(item: Json): string | null {
  const authors = Array.isArray(item.authors) ? item.authors : item.author ? [item.author] : [];
  for (const a of authors) {
    const name = a && typeof a === "object" ? str((a as Json).name) : null;
    if (name) return name;
  }
  return null;
}

function imageUrl(item: Json): string | null {
  const direct = str(item.image) ?? str(item.banner_image);
  if (direct) return direct;
  const attachments = Array.isArray(item.attachments) ? item.attachments as Json[] : [];
  const image = attachments.find((a) => typeof a?.mime_type === "string" && a.mime_type.startsWith("image/"));
  return image ? str(image.url) : null;
}

/** JSON Feed podcasts carry the episode as an audio or video attachment. */
function playableAttachment(item: Json): ArticleMedia | null {
  const attachments = Array.isArray(item.attachments) ? item.attachments as Json[] : [];
  const media = attachments.find((a) => typeof a?.mime_type === "string" && /^(audio|video)\//.test(a.mime_type));
  const url = media ? str(media.url) : null;
  return url ? { url, type: str(media!.mime_type) } : null;
}

/** Parse a JSON Feed (https://jsonfeed.org, versions 1 and 1.1). */
export function parseJsonFeed(text: string): ParsedFeed {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error("feed is not valid JSON");
  }
  if (!doc || typeof doc !== "object" || !String((doc as Json).version ?? "").startsWith("https://jsonfeed.org/version/")) {
    throw new Error("JSON document is not a JSON Feed (no jsonfeed.org version)");
  }
  const feed = doc as Json;
  if (!Array.isArray(feed.items)) throw new Error("JSON Feed has no items array");
  const articles: ParsedArticle[] = [];
  for (const raw of feed.items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Json;
    // id is required by the spec and is the item's identity; 1.0 feeds sometimes use numbers.
    const id = typeof item.id === "number" ? String(item.id) : str(item.id);
    if (!id) continue;
    articles.push({
      guid: id,
      url: str(item.url) ?? str(item.external_url),
      title: titleFrom(item),
      author: authorName(item) ?? authorName(feed),
      publishedAt: date(item.date_published) ?? date(item.date_modified),
      contentHtml: str(item.content_html) ?? str(item.content_text),
      summary: str(item.summary),
      imageUrl: imageUrl(item),
      media: playableAttachment(item),
      categories: limitCategories(Array.isArray(item.tags) ? item.tags.filter((t): t is string => typeof t === "string") : []),
    });
  }
  return { title: str(feed.title) ?? "(untitled feed)", siteUrl: str(feed.home_page_url), articles, olderUrl: str(feed.next_url) };
}
