import { describe, it, expect } from "vitest";
import { parseFeed } from "../src/parse.js";

const PAGE = `<!doctype html><html><head><title>Ann's site</title></head><body>
<div class="h-feed"><h1 class="p-name">Ann Notes</h1><a class="p-author h-card" href="/">Ann</a>
<article class="h-entry">
  <h2 class="p-name"><a class="u-url" href="/posts/1">First post</a></h2>
  <time class="dt-published" datetime="2026-07-01T12:00:00Z">Jul 1</time>
  <div class="e-content"><p>Hello <b>mf2</b></p><img src="/img/a.jpg"></div>
  <a class="p-category" href="/tag/web">web</a><a class="p-category" href="/tag/indie">indie</a>
</article>
<article class="h-entry">
  <p class="e-content">A short note with no title at all</p>
  <a class="u-url" href="/notes/2"><time class="dt-published" datetime="2026-07-02T08:00:00Z">Jul 2</time></a>
  <img class="u-photo" src="/p.jpg">
  <div class="h-cite u-in-reply-to"><a class="u-url" href="https://other.example/x">quoted</a></div>
</article>
</div></body></html>`;

describe("h-feed", () => {
  it("reads h-entry posts from an HTML page, resolving links against its URL", async () => {
    const feed = await parseFeed(PAGE, { url: "https://ann.example/" });
    expect(feed.title).toBe("Ann Notes");
    expect(feed.siteUrl).toBe("https://ann.example/");
    expect(feed.articles).toHaveLength(2);
    expect(feed.articles[0]).toMatchObject({
      guid: "https://ann.example/posts/1",
      url: "https://ann.example/posts/1",
      title: "First post",
      author: "Ann",
      publishedAt: new Date("2026-07-01T12:00:00Z"),
      contentHtml: '<p>Hello <b>mf2</b></p><img src="https://ann.example/img/a.jpg">',
      categories: ["web", "indie"],
    });
    expect(feed.articles[1]).toMatchObject({
      guid: "https://ann.example/notes/2",
      title: "A short note with no title at all",
      imageUrl: "https://ann.example/p.jpg",
      author: "Ann",
    });
  });

  it("falls back to the page title, and refuses pages without entries or a URL", async () => {
    const bare = `<!doctype html><html><head><title>Loose</title></head><body><div class="h-entry"><p class="p-name">Only</p></div></body></html>`;
    expect((await parseFeed(bare, { url: "https://x.example/" })).title).toBe("Loose");
    await expect(parseFeed("<!doctype html><html><body><p>plain</p></body></html>", { url: "https://x.example/" })).rejects.toThrow(/no h-entry/);
    await expect(parseFeed(PAGE)).rejects.toThrow(/needs its URL/);
  });
});
