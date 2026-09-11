import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFeed } from "../src/parse.js";
import { plainTextToHtml } from "../src/content.js";

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");

describe("parseFeed", () => {
  it("decodes common entities when preserving plain feed text", () => {
    expect(plainTextToHtml("One &gt; two &amp; three\n\n&lt;tap&gt;")).toContain("One &gt; two &amp; three");
    expect(plainTextToHtml("One &gt; two &amp; three\n\n&lt;tap&gt;")).not.toContain("&amp;gt;");
  });

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

  it("rejects a feed carrying a DOCTYPE internal subset (XXE/billion-laughs)", async () => {
    const xxe = `<?xml version="1.0"?>
<!DOCTYPE rss [ <!ENTITY lol "lol"> ]>
<rss version="2.0"><channel><title>x</title></channel></rss>`;
    await expect(parseFeed(xxe)).rejects.toThrow(/DOCTYPE internal subset/);
  });

  it("parses Atom feeds", async () => {
    const feed = await parseFeed(fixture("atom.xml"));
    expect(feed.title).toBe("Atom Blog");
    expect(feed.articles).toHaveLength(1);
    expect(feed.articles[0]!.guid).toBe("tag:example.com,2026:1");
  });

  it("collects subject categories from RSS and Atom items", async () => {
    const rss = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>C</title><link>https://c.example.com</link>
<item><title>A</title><guid>cs1</guid>
<category>World</category><category>  Politics </category><category>World</category>
<category>${"x".repeat(60)}</category>
</item></channel></rss>`;
    const atom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>AF</title>
<entry><title>E</title><id>tag:example.com,2026:cs2</id>
<category term="Tech"/><category label="Science" term="Science"/>
</entry></feed>`;
    const rssFeed = await parseFeed(rss);
    expect(rssFeed.articles[0]!.categories).toEqual(["World", "Politics", "x".repeat(40)]);
    const atomFeed = await parseFeed(atom);
    expect(atomFeed.articles[0]!.categories).toEqual(["Tech", "Science"]);
  });

  it("promotes HTML summaries and keeps enclosure media", async () => {
    const feed = await parseFeed(`<?xml version="1.0"?>
      <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/">
        <channel><title>Media</title><link>https://example.com</link><item>
          <title>Quote</title><link>https://example.com/quote</link>
          <description>Short summary</description>
          <content:encoded><![CDATA[<blockquote><p>Quoted</p></blockquote>]]></content:encoded>
          <enclosure url="https://example.com/cover.jpg" type="image/jpeg" />
        </item><item>
          <title>Summary body</title><link>https://example.com/summary</link>
          <description><![CDATA[<p>Body in summary</p>]]></description>
          <media:thumbnail url="https://example.com/thumb.jpg" />
        </item></channel>
      </rss>`);
    expect(feed.articles[0]!.contentHtml).toContain("<blockquote>");
    expect(feed.articles[0]!.imageUrl).toBe("https://example.com/cover.jpg");
    expect(feed.articles[1]!.contentHtml).toContain("<p>Body in summary</p>");
    expect(feed.articles[1]!.imageUrl).toBe("https://example.com/thumb.jpg");
  });

  it("reads thumbnail and description from a YouTube media:group", async () => {
    const feed = await parseFeed(fixture("youtube.xml"));
    const [video, short] = feed.articles;
    expect(video!.imageUrl).toBe("https://i4.ytimg.com/vi/vid00000001/hqdefault.jpg");
    expect(video!.summary).toBe("What this video covers.\n\nLinks: https://example.com/notes");
    expect(video!.contentHtml).toBeNull();
    expect(short!.imageUrl).toBe("https://i1.ytimg.com/vi/vid00000002/hqdefault.jpg");
    expect(short!.summary).toBeNull();
  });

  it("reads the publisher's refresh hint from <ttl> or the syndication module", async () => {
    const rss = (channel: string) => `<?xml version="1.0"?><rss version="2.0" xmlns:sy="http://purl.org/rss/1.0/modules/syndication/"><channel><title>T</title>${channel}</channel></rss>`;
    expect((await parseFeed(rss("<ttl>180</ttl>"))).updateHintMinutes).toBe(180);
    expect((await parseFeed(rss("<sy:updatePeriod>daily</sy:updatePeriod><sy:updateFrequency>4</sy:updateFrequency>"))).updateHintMinutes).toBe(360);
    expect((await parseFeed(rss("<sy:updatePeriod>hourly</sy:updatePeriod>"))).updateHintMinutes).toBe(60);
    expect((await parseFeed(rss("<ttl>soon</ttl>"))).updateHintMinutes).toBeNull();
  });

  it("keeps podcast audio out of the image and reads Podcasting 2.0 tags", async () => {
    const feed = await parseFeed(fixture("podcast.xml"));
    const [ep1, ep2] = feed.articles;
    expect(ep1).toMatchObject({
      imageUrl: "https://pod.example.com/ep1.jpg",
      media: { url: "https://cdn.example.com/ep1.mp3", type: "audio/mpeg" },
      transcript: { url: "https://pod.example.com/ep1.vtt", type: "text/vtt" },
      chaptersUrl: "https://pod.example.com/ep1-chapters.json",
    });
    expect(ep2).toMatchObject({
      imageUrl: "https://pod.example.com/show.jpg",
      media: { url: "https://cdn.example.com/ep2.mp4", type: "video/mp4" },
      transcript: null,
      chaptersUrl: null,
    });
  });

  it("finds where older items continue (RFC 5005 paging and archives)", async () => {
    const rss = await parseFeed(`<?xml version="1.0"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>R</title><link>https://r.example/</link>
      <atom:link rel="self" href="https://r.example/feed"/><atom:link rel="prev-archive" href="/2025.xml"/><atom:link rel="next" href="/feed?page=2"/></channel></rss>`);
    expect(rss.olderUrl).toBe("/feed?page=2");
    expect(rss.siteUrl).toBe("https://r.example/");
    const atom = await parseFeed(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>A</title>
      <link rel="alternate" href="https://a.example/"/><link rel="prev-archive" href="https://a.example/2025.xml"/></feed>`);
    expect(atom.olderUrl).toBe("https://a.example/2025.xml");
    expect(atom.siteUrl).toBe("https://a.example/");
    expect((await parseFeed(fixture("rss2.xml"))).olderUrl).toBeNull();
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
