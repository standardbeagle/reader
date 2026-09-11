import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { discoverFeeds } from "../src/discovery/discover.js";

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Site Feed</title><link>https://x</link><item><title>i</title><guid>g1</guid></item></channel></rss>`;
const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Atom One</title><entry><id>e1</id><title>t</title><updated>2026-01-01T00:00:00Z</updated></entry></feed>`;

interface Route { status?: number; contentType?: string; body: string; redirect?: string }
let server: Server;
let baseUrl: string;
let routes: Map<string, Route>;

async function start(r: Record<string, Route>) {
  routes = new Map(Object.entries(r));
  server = createServer((req, res) => {
    const route = routes.get(req.url ?? "/");
    if (!route) { res.writeHead(404).end("nope"); return; }
    if (route.redirect) { res.writeHead(302, { location: route.redirect }).end(); return; }
    res.writeHead(route.status ?? 200, { "content-type": route.contentType ?? "text/html" });
    res.end(route.body);
  });
  await new Promise<void>((r2) => server.listen(0, "127.0.0.1", r2));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
afterEach(async () => { await new Promise((r) => server.close(r)); });

describe("discoverFeeds", () => {
  it("returns the url itself when it is already a feed", async () => {
    await start({ "/feed.xml": { contentType: "application/rss+xml", body: RSS } });
    const found = await discoverFeeds(`${baseUrl}/feed.xml`);
    expect(found).toEqual([{ url: `${baseUrl}/feed.xml`, title: "Site Feed", kind: "rss" }]);
  });

  it("verifies a linked JSON Feed and reports its kind", async () => {
    const json = JSON.stringify({ version: "https://jsonfeed.org/version/1.1", title: "JSON One", items: [{ id: "1", content_text: "hi" }] });
    await start({
      "/": { body: `<html><head><link rel="alternate" type="application/feed+json" title="JSON" href="/feed.json"></head></html>` },
      "/feed.json": { contentType: "application/feed+json", body: json },
    });
    const found = await discoverFeeds(baseUrl + "/");
    expect(found).toContainEqual({ url: `${baseUrl}/feed.json`, title: "JSON One", kind: "json" });
  });

  it("offers an IndieWeb page as an h-feed, after any real feed it links", async () => {
    const entries = `<div class="h-feed"><h1 class="p-name">Notes</h1><article class="h-entry"><a class="u-url p-name" href="/n/1">One</a></article></div>`;
    await start({
      "/indie": { body: `<!doctype html><html><head><title>Indie</title></head><body>${entries}</body></html>` },
      "/both": { body: `<!doctype html><html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head><body>${entries}</body></html>` },
      "/feed.xml": { contentType: "application/rss+xml", body: RSS },
    });
    expect(await discoverFeeds(`${baseUrl}/indie`)).toEqual([
      { url: `${baseUrl}/feed.xml`, title: "Site Feed", kind: "rss" },
      { url: `${baseUrl}/indie`, title: "Notes", kind: "h-feed" },
    ]);
    const both = await discoverFeeds(`${baseUrl}/both`);
    expect(both.map((f) => f.kind)).toEqual(["rss", "h-feed"]);
  });

  it("extracts link rel=alternate tags, resolving relative hrefs", async () => {
    const html = `<html><head>
      <link rel="alternate" type="application/rss+xml" title="Main RSS" href="/feed.xml">
      <link rel="alternate" type="application/atom+xml" href="https://cdn.example.com/atom.xml">
      <link rel="stylesheet" href="/style.css">
      </head><body>hi</body>`;
    await start({
      "/": { body: html },
      "/feed.xml": { contentType: "application/rss+xml", body: RSS },
    });
    const found = await discoverFeeds(baseUrl + "/");
    const urls = found.map((f) => f.url);
    expect(urls).toContain(`${baseUrl}/feed.xml`);
    expect(urls).toContain("https://cdn.example.com/atom.xml");
    const main = found.find((f) => f.url === `${baseUrl}/feed.xml`)!;
    expect(main.title).toBe("Site Feed");
    expect(main.kind).toBe("rss");
  });

  it("probes common paths when no link tags exist", async () => {
    await start({
      "/": { body: "<html><head></head><body>plain</body></html>" },
      "/feed": { contentType: "application/rss+xml", body: RSS },
    });
    const found = await discoverFeeds(baseUrl + "/");
    expect(found.map((f) => f.url)).toEqual([`${baseUrl}/feed`]);
  });

  it("rejects soft-404 sites that return HTML 200 for every path", async () => {
    await start({});
    // register a catch-all by seeding every common path with HTML
    server.close();
    const html = "<html><body>not found page</body></html>";
    await start({
      "/": { body: html }, "/feed": { body: html }, "/feed.xml": { body: html },
      "/rss": { body: html }, "/rss.xml": { body: html }, "/atom.xml": { body: html },
      "/index.xml": { body: html }, "/feeds": { body: html }, "/feed/": { body: html },
      "/atom": { body: html }, "/feed/atom/": { body: html }, "/feed/rss/": { body: html },
      "/blog/feed": { body: html }, "/feed.json": { body: html }, "/rss/": { body: html },
    });
    const found = await discoverFeeds(baseUrl + "/");
    expect(found).toEqual([]);
  });

  it("detects atom kind", async () => {
    await start({ "/atom.xml": { contentType: "application/atom+xml", body: ATOM } });
    const found = await discoverFeeds(`${baseUrl}/atom.xml`);
    expect(found[0]!.kind).toBe("atom");
  });

  it("throws on unreachable hosts", async () => {
    await start({ "/": { body: "x" } });
    const port = new URL(baseUrl).port;
    server.close();
    await expect(discoverFeeds(`http://127.0.0.1:${port}/`)).rejects.toThrow();
    server = createServer().listen(0); // dummy so afterEach close works
  });

  it("ignores link tags with non-http(s) hrefs", async () => {
    const html = `<html><head>
      <link rel="alternate" type="application/rss+xml" href="javascript:alert(1)">
      </head><body>hi</body>`;
    await start({ "/": { body: html } });
    const found = await discoverFeeds(baseUrl + "/");
    expect(found.some((f) => f.url.startsWith("javascript:"))).toBe(false);
  });

  it("accepts single-quoted link tag attributes", async () => {
    const html = `<html><head>
      <link rel='alternate' type='application/rss+xml' href='/feed.xml'>
      </head><body>hi</body>`;
    await start({
      "/": { body: html },
      "/feed.xml": { contentType: "application/rss+xml", body: RSS },
    });
    const found = await discoverFeeds(baseUrl + "/");
    expect(found.map((f) => f.url)).toContain(`${baseUrl}/feed.xml`);
  });

  it("dedupes probes that redirect to the same final feed URL", async () => {
    await start({
      "/": { body: "<html><head></head><body>plain</body></html>" },
      "/feed": { body: "", redirect: "/feed.xml" },
      "/feed.xml": { contentType: "application/rss+xml", body: RSS },
    });
    const found = await discoverFeeds(baseUrl + "/");
    expect(found).toEqual([{ url: `${baseUrl}/feed.xml`, title: "Site Feed", kind: "rss" }]);
  });

  it("resolves relative link hrefs against the post-redirect page URL", async () => {
    const html = `<html><head>
      <link rel="alternate" type="application/rss+xml" href="feed.xml">
      </head><body>hi</body>`;
    await start({
      "/old": { body: "", redirect: "/new" },
      "/new": { body: html },
    });
    const found = await discoverFeeds(`${baseUrl}/old`);
    // new URL("feed.xml", "http://host/new") resolves to root (no trailing slash)
    expect(found.map((f) => f.url)).toContain(`${baseUrl}/feed.xml`);
  });
});
