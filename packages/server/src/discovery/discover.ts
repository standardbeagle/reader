import pLimit from "p-limit";
import { parseFeed } from "@reader/core";
import { fetchCapped } from "../fetch.js";

export interface DiscoveredFeed { url: string; title: string; kind: "rss" | "atom" | "json" }

const COMMON_PATHS = [
  "/feed", "/feed.xml", "/rss", "/rss.xml", "/atom.xml", "/index.xml",
  "/feeds", "/feed/", "/atom", "/feed/atom/", "/feed/rss/", "/blog/feed",
  "/feed.json", "/rss/",
];

const FEED_MIME = /^application\/(rss\+xml|atom\+xml|feed\+json)$/i;

const MAX_LINK_FEEDS = 10;
const VERIFY_DEADLINE_MS = 20_000;

function detectKind(body: string): "rss" | "atom" | "json" {
  const t = body.trimStart();
  if (t.startsWith("{")) return "json";
  return t.includes("<feed") ? "atom" : "rss";
}

function kindFromMime(mime: string | undefined): "rss" | "atom" | "json" {
  if (mime === "application/atom+xml") return "atom";
  if (mime === "application/feed+json") return "json";
  return "rss";
}

function extractLinkFeeds(html: string, baseUrl: string): DiscoveredFeed[] {
  const feeds: DiscoveredFeed[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const attrs = Object.fromEntries(
      [...tag.matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/g)].map((a) => [a[1]!.toLowerCase(), a[3]!]),
    );
    if (!/\balternate\b/i.test(attrs.rel ?? "")) continue;
    if (!FEED_MIME.test(attrs.type ?? "")) continue;
    if (!attrs.href) continue;
    try {
      const resolved = new URL(attrs.href, baseUrl);
      if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue;
      feeds.push({
        url: resolved.href,
        title: attrs.title ?? "",
        kind: kindFromMime(attrs.type),
      });
    } catch { /* bad href */ }
  }
  return feeds;
}

async function tryParse(url: string): Promise<DiscoveredFeed | null> {
  try {
    const res = await fetchCapped(url, { maxBytes: 2 * 1024 * 1024, timeoutMs: 8_000 });
    if (res.status !== 200) return null;
    const parsed = await parseFeed(res.body);
    return { url: res.finalUrl, title: parsed.title, kind: detectKind(res.body) };
  } catch {
    return null;
  }
}

export async function discoverFeeds(url: string): Promise<DiscoveredFeed[]> {
  const res = await fetchCapped(url, { maxBytes: 5 * 1024 * 1024 });
  if (res.status >= 400) throw new Error(`HTTP ${res.status}`);

  try {
    const parsed = await parseFeed(res.body);
    return [{ url: res.finalUrl, title: parsed.title, kind: detectKind(res.body) }];
  } catch { /* not a feed — treat as HTML and discover */ }

  const linked = extractLinkFeeds(res.body, res.finalUrl).slice(0, MAX_LINK_FEEDS);
  const candidates = linked.map((f) => f.url);
  const origin = new URL(res.finalUrl).origin;
  for (const path of COMMON_PATHS) {
    const candidate = origin + path;
    if (!candidates.includes(candidate)) candidates.push(candidate);
  }

  const limit = pLimit(4);
  const results: (DiscoveredFeed | null)[] = [];
  const probes = Promise.all(
    candidates.map((c) => limit(async () => { results.push(await tryParse(c)); })),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => { timer = setTimeout(resolve, VERIFY_DEADLINE_MS); });
  await Promise.race([probes, deadline]);
  clearTimeout(timer);
  const seen = new Set<string>();
  const found: DiscoveredFeed[] = [];
  for (const r of results) {
    if (r && !seen.has(r.url)) { seen.add(r.url); found.push(r); }
  }
  for (const f of linked) {
    if (!seen.has(f.url)) { seen.add(f.url); found.push(f); }
  }
  return found;
}
