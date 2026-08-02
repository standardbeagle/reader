import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFeed } from "../src/parse.js";

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");

describe("parseFeed", () => {
  it("parses RSS 2.0 with title, site url and items", async () => {
    const feed = await parseFeed(fixture("rss2.xml"));
    expect(feed.title).toBe("Example Blog");
    expect(feed.siteUrl).toBe("https://example.com");
    expect(feed.articles).toHaveLength(2);
    const first = feed.articles[0]!;
    expect(first.guid).toBe("urn:uuid:1");
    expect(first.title).toBe("First Post");
    expect(first.url).toBe("https://example.com/first");
    expect(first.publishedAt?.toISOString()).toBe("2026-07-01T12:00:00.000Z");
    expect(first.contentHtml).toContain("<p>Hello world</p>");
    expect(first.contentHtml).toContain("<p>Full body</p>");
  });

  it("parses Atom feeds", async () => {
    const feed = await parseFeed(fixture("atom.xml"));
    expect(feed.title).toBe("Atom Blog");
    expect(feed.articles).toHaveLength(1);
    expect(feed.articles[0]!.guid).toBe("tag:example.com,2026:1");
  });

  it("synthesizes a stable guid when missing", async () => {
    const a = await parseFeed(fixture("no-guid.xml"));
    const b = await parseFeed(fixture("no-guid.xml"));
    expect(a.articles[0]!.guid).toBe(b.articles[0]!.guid);
    expect(a.articles[0]!.guid).toMatch(/^sha1:[0-9a-f]{40}$/);
  });

  it("tolerates missing dates and authors", async () => {
    const feed = await parseFeed(fixture("no-guid.xml"));
    expect(feed.articles[0]!.publishedAt).toBeNull();
    expect(feed.articles[0]!.author).toBeNull();
  });

  it("rejects on malformed XML", async () => {
    await expect(parseFeed("<rss><channel><item>")).rejects.toThrow();
  });

  it("synthesizes distinct guids for guid-less items sharing a link", async () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>t</title><link>https://x.example</link>
<item><title>Alpha</title><link>https://x.example/same</link></item>
<item><title>Beta</title><link>https://x.example/same</link></item>
</channel></rss>`;
    const feed = await parseFeed(xml);
    expect(feed.articles).toHaveLength(2);
    expect(feed.articles[0]!.guid).not.toBe(feed.articles[1]!.guid);
  });
});
