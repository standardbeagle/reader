// One-off generator for apps/web/src/demo/seed.json. Reads the local dev
// database (packages/server/reader.db), keeps the newest articles of the four
// demo feeds, trims article bodies, and marks every third article read so the
// demo shows a realistic unread mix. Re-run against a fresh dev DB to refresh
// the demo content.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";

const require = createRequire(new URL("../packages/server/package.json", import.meta.url));
const Database = require("better-sqlite3");

const FEED_URLS = [
  "https://www.nasa.gov/feeds/iotd-feed",
  "https://www.theverge.com/rss/index.xml",
  "https://hnrss.org/frontpage",
  "https://daringfireball.net/feeds/main",
];
const PER_FEED = 15;
const MAX_BODY = 1500;

const db = new Database("packages/server/reader.db", { readonly: true });
const user = db.prepare("SELECT id FROM users LIMIT 1").get();

const feeds = db.prepare(
  `SELECT id, url, title, site_url AS siteUrl, status, last_fetched_at AS lastFetchedAt FROM feeds WHERE url IN (${FEED_URLS.map(() => "?").join(",")})`,
).all(...FEED_URLS);

const articles = [];
for (const feed of feeds) {
  const rows = db.prepare(
    `SELECT a.id, a.feed_id AS feedId, a.title, a.url, a.author, a.published_at AS publishedAt,
            a.content_html AS contentHtml, a.summary, a.image_url AS imageUrl, a.categories,
            ua.read_at AS readAt
     FROM articles a JOIN user_articles ua ON ua.article_id = a.id AND ua.user_id = ?
     WHERE a.feed_id = ? ORDER BY a.published_at DESC LIMIT ?`,
  ).all(user.id, feed.id, PER_FEED);
  rows.forEach((row, i) => {
    let body = row.contentHtml;
    if (body && body.length > MAX_BODY) {
      const cut = body.lastIndexOf("</p>", MAX_BODY);
      body = cut > 0 ? body.slice(0, cut + 4) : body.slice(0, MAX_BODY);
    }
    articles.push({
      id: row.id,
      feedId: row.feedId,
      title: row.title,
      url: row.url,
      author: row.author,
      publishedAt: row.publishedAt,
      contentHtml: body,
      summary: row.summary,
      imageUrl: row.imageUrl,
      categories: JSON.parse(row.categories ?? "[]"),
      readAt: i % 3 === 2 ? new Date(Date.parse(row.publishedAt ?? "") + 3_600_000).toISOString() : null,
    });
  });
}

articles.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));

const list = {
  id: "demo-list-read-later",
  title: "Read later",
  visibility: "public",
  token: "demo-read-later",
  createdAt: new Date().toISOString(),
};
const listItems = articles.filter((_, i) => i % 17 === 0).map((a) => a.id);

const seed = { feeds, articles, lists: [list], listItems };
writeFileSync("apps/web/src/demo/seed.json", JSON.stringify(seed));
const kb = Math.round(JSON.stringify(seed).length / 1024);
console.log(`feeds=${feeds.length} articles=${articles.length} listItems=${listItems.length} size=${kb}KB`);
