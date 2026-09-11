// Generator for apps/web/src/demo/seed.json. Reads a reader database, keeps
// the newest articles of the demo feeds, trims article bodies, and marks every
// third article read so the demo shows a realistic unread mix. For the newest
// podcast episodes it also bundles chapters and transcripts, fetched from a
// running server so they are normalized exactly as the real API returns them.
//
// Usage: node scripts/build-demo-seed.mjs [dbPath] [apiBase]
//   dbPath   defaults to packages/server/reader.db
//   apiBase  a server running on that database, e.g. http://127.0.0.1:3799
//            (without it, episodes ship without chapters and transcripts)
//
// Subscribe the server to every FEED_URLS entry first.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
// Same title decoding the server applies when reading rows (build core first).
import { decodeHtmlEntities } from "../packages/core/dist/index.js";

const require = createRequire(new URL("../packages/server/package.json", import.meta.url));
const Database = require("better-sqlite3");

const FEED_URLS = [
  "https://www.nasa.gov/feeds/iotd-feed",
  "https://www.theverge.com/rss/index.xml",
  "https://hnrss.org/frontpage",
  "https://daringfireball.net/feeds/json", // JSON Feed 1.1
  "https://feeds.podcastindex.org/pc20.xml", // Podcasting 2.0: chapters + transcripts
  "https://www.youtube.com/feeds/videos.xml?channel_id=UCsBjURrPoezykLs9EqgamOA", // Fireship
];
const [dbPath = "packages/server/reader.db", apiBase = null] = process.argv.slice(2);
const EPISODES_WITH_EXTRAS = 3;
// The demo's public list shows what a public list is for: the things in one
// topic you'd pass on to others, picked from everything you read. These are
// editorial picks; when the feeds roll over, pick again (the script fails if
// one is gone rather than publish a thinner list).
const CURATED_LIST = {
  id: "demo-list-neat-stuff",
  title: "Neat stuff",
  token: "neat-stuff",
  urls: [
    "http://www.iaea.org/newscenter/news/what-is-cherenkov-radiation",
    "https://vale.rocks/posts/css-relics",
    "https://www.upsocl.com/en/16-year-old-mexican-student-creates-an-acoustic-fire-extinguisher-that-uses-sound-waves-to-put-out-fires-in-seconds/",
    "https://www.nasa.gov/image-detail/hubble-n44-wfc3-large/",
    "https://www.nasa.gov/image-detail/amf-nhq202606170001/",
    "https://www.youtube.com/watch?v=0Rp9KJCEIvg",
    "https://daringfireball.net/linked/2026/09/08/modern-day-typographer",
  ],
};
const MAX_TRANSCRIPT_CUES = 150;
const PER_FEED = 15;
const MAX_BODY = 1500;

const db = new Database(dbPath, { readonly: true });
const user = db.prepare("SELECT id FROM users LIMIT 1").get();

const feeds = db.prepare(
  `SELECT id, url, title, site_url AS siteUrl, status, last_fetched_at AS lastFetchedAt FROM feeds WHERE url IN (${FEED_URLS.map(() => "?").join(",")})`,
).all(...FEED_URLS);

const articles = [];
for (const feed of feeds) {
  const rows = db.prepare(
    `SELECT a.id, a.feed_id AS feedId, a.title, a.url, a.author, a.published_at AS publishedAt,
            a.content_html AS contentHtml, a.summary, a.image_url AS imageUrl, a.categories,
            a.media_url AS mediaUrl, a.media_type AS mediaType, a.transcript_url AS transcriptUrl,
            a.transcript_type AS transcriptType, a.chapters_url AS chaptersUrl,
            ua.read_at AS readAt
     FROM articles a JOIN user_articles ua ON ua.article_id = a.id AND ua.user_id = ?
     WHERE a.feed_id = ? ORDER BY a.published_at DESC LIMIT ?`,
  ).all(user.id, feed.id, PER_FEED);
  // Curated picks stay in the seed even after newer items push them out of the window.
  for (const url of CURATED_LIST.urls) {
    if (rows.some((r) => r.url === url)) continue;
    const pick = db.prepare(
      `SELECT a.id, a.feed_id AS feedId, a.title, a.url, a.author, a.published_at AS publishedAt,
              a.content_html AS contentHtml, a.summary, a.image_url AS imageUrl, a.categories,
              a.media_url AS mediaUrl, a.media_type AS mediaType, a.transcript_url AS transcriptUrl,
              a.transcript_type AS transcriptType, a.chapters_url AS chaptersUrl,
              ua.read_at AS readAt
       FROM articles a JOIN user_articles ua ON ua.article_id = a.id AND ua.user_id = ?
       WHERE a.feed_id = ? AND a.url = ?`,
    ).get(user.id, feed.id, url);
    if (pick) rows.push(pick);
  }
  rows.forEach((row, i) => {
    let body = row.contentHtml;
    if (body && body.length > MAX_BODY) {
      const cut = body.lastIndexOf("</p>", MAX_BODY);
      body = cut > 0 ? body.slice(0, cut + 4) : body.slice(0, MAX_BODY);
    }
    articles.push({
      id: row.id,
      feedId: row.feedId,
      title: decodeHtmlEntities(row.title),
      url: row.url,
      author: row.author,
      publishedAt: row.publishedAt,
      contentHtml: body,
      summary: row.summary,
      imageUrl: row.imageUrl,
      categories: JSON.parse(row.categories ?? "[]"),
      media: row.mediaUrl ? { url: row.mediaUrl, type: row.mediaType } : null,
      transcript: row.transcriptUrl ? { url: row.transcriptUrl, type: row.transcriptType } : null,
      chaptersUrl: row.chaptersUrl,
      readAt: i % 3 === 2 ? new Date(Date.parse(row.publishedAt ?? "") + 3_600_000).toISOString() : null,
    });
  });
}

articles.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));

const list = {
  id: CURATED_LIST.id,
  title: CURATED_LIST.title,
  visibility: "public",
  token: CURATED_LIST.token,
  createdAt: new Date().toISOString(),
};
const listItems = CURATED_LIST.urls.map((url) => {
  const hit = articles.find((a) => a.url === url);
  if (!hit) throw new Error(`curated pick no longer in the demo feeds: ${url}`);
  return hit.id;
});

// Chapters and transcripts for the newest episodes, as the server serves them.
const podcastExtras = {};
if (apiBase) {
  const episodes = articles.filter((a) => a.media && (a.chaptersUrl || a.transcript)).slice(0, EPISODES_WITH_EXTRAS);
  for (const episode of episodes) {
    const get = async (path) => {
      const res = await fetch(`${apiBase}/api/v1/articles/${episode.id}/${path}`);
      if (!res.ok) throw new Error(`${path} for "${episode.title}": HTTP ${res.status}`);
      return res.json();
    };
    const chapters = episode.chaptersUrl ? (await get("chapters")).chapters : null;
    const transcript = episode.transcript ? await get("transcript") : null;
    if (transcript?.kind === "cues") transcript.cues = transcript.cues.slice(0, MAX_TRANSCRIPT_CUES);
    podcastExtras[episode.id] = { chapters, transcript };
  }
}
// Framing checks for every article, so the demo's Embedded page tab behaves
// as it would against a real server.
const embeddability = {};
if (apiBase) {
  const queue = [...articles];
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let a; (a = queue.shift()); ) {
      if (!a.url) continue;
      const res = await fetch(`${apiBase}/api/v1/articles/${a.id}/embeddable`);
      if (res.ok) embeddability[a.id] = await res.json();
    }
  }));
}
// Episodes without bundled extras must not offer sections the demo cannot fill.
for (const a of articles) {
  if (a.media && !podcastExtras[a.id]) { a.transcript = null; a.chaptersUrl = null; }
}

const seed = { feeds, articles, lists: [list], listItems, podcastExtras, embeddability };
writeFileSync("apps/web/src/demo/seed.json", JSON.stringify(seed));
const kb = Math.round(JSON.stringify(seed).length / 1024);
const blocked = Object.values(embeddability).filter((e) => e.embeddable === false).length;
console.log(`feeds=${feeds.length} articles=${articles.length} listItems=${listItems.length} episodesWithExtras=${Object.keys(podcastExtras).length} framingChecked=${Object.keys(embeddability).length} framingBlocked=${blocked} size=${kb}KB`);
