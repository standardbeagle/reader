import { describe, it, expect } from "vitest";
import { parseFeed } from "../src/parse.js";

const feed = (items: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({
  version: "https://jsonfeed.org/version/1.1",
  title: "JSON Blog",
  home_page_url: "https://json.example.com/",
  feed_url: "https://json.example.com/feed.json",
  items,
  ...extra,
});

describe("JSON Feed", () => {
  it("maps a JSON Feed 1.1 item onto an article", async () => {
    const parsed = await parseFeed(feed([{
      id: "https://json.example.com/p/1",
      url: "https://json.example.com/p/1",
      title: "Hello JSON",
      content_html: "<p>Body</p>",
      summary: "Short",
      image: "https://json.example.com/hero.jpg",
      date_published: "2026-07-01T12:00:00Z",
      authors: [{ name: "Ann" }],
      tags: ["web", " feeds ", "web"],
    }]));
    expect(parsed.title).toBe("JSON Blog");
    expect(parsed.siteUrl).toBe("https://json.example.com/");
    expect(parsed.olderUrl).toBeNull();
    expect((await parseFeed(feed([], { next_url: "https://json.example.com/feed.json?page=2" }))).olderUrl).toBe("https://json.example.com/feed.json?page=2");
    expect(parsed.articles).toEqual([{
      guid: "https://json.example.com/p/1",
      url: "https://json.example.com/p/1",
      title: "Hello JSON",
      author: "Ann",
      publishedAt: new Date("2026-07-01T12:00:00Z"),
      contentHtml: "<p>Body</p>",
      summary: "Short",
      imageUrl: "https://json.example.com/hero.jpg",
      categories: ["web", "feeds"],
      media: null,
    }]);
  });

  it("handles version 1 authors, numeric ids, untitled text posts and image attachments", async () => {
    const parsed = await parseFeed(feed([{
      id: 42,
      external_url: "https://elsewhere.example.com/story",
      content_text: "Just a short microblog post that has no title of its own at all, which is common in JSON Feed",
      author: { name: "Bob" },
      date_modified: "2026-07-02T00:00:00Z",
      attachments: [{ url: "https://json.example.com/a.mp3", mime_type: "audio/mpeg" }, { url: "https://json.example.com/b.png", mime_type: "image/png" }],
    }], { version: "https://jsonfeed.org/version/1" }));
    const [item] = parsed.articles;
    expect(item).toMatchObject({
      guid: "42",
      url: "https://elsewhere.example.com/story",
      author: "Bob",
      contentHtml: "Just a short microblog post that has no title of its own at all, which is common in JSON Feed",
      summary: null,
      imageUrl: "https://json.example.com/b.png",
      publishedAt: new Date("2026-07-02T00:00:00Z"),
      media: { url: "https://json.example.com/a.mp3", type: "audio/mpeg" },
    });
    expect(item!.title).toBe("Just a short microblog post that has no title of its own at all, which is…");
  });

  it("skips items without an id and tolerates a leading BOM and whitespace", async () => {
    const parsed = await parseFeed("\uFEFF \n" + feed([{ title: "no id" }, { id: "x", title: "kept" }]));
    expect(parsed.articles.map((a) => a.guid)).toEqual(["x"]);
  });

  it("rejects JSON that is not a JSON Feed", async () => {
    await expect(parseFeed(`{"hello": "world"}`)).rejects.toThrow(/JSON Feed/);
    await expect(parseFeed(`{"version": "https://jsonfeed.org/version/1.1", "items": "nope"}`)).rejects.toThrow(/items/);
    await expect(parseFeed(`{not json`)).rejects.toThrow(/JSON/);
  });
});
