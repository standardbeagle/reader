import { describe, expect, it } from "vitest";
import type { Feed } from "./api";
import { groupFeeds, streamArticlePath, streamFromParams, streamKey, streamPath, streamQuery, streamTitle, type Stream } from "./streams";

const titles = { feed: (id: string) => (id === "f1" ? "Ars Technica" : null), list: (id: string) => (id === "l1" ? "Commute" : null) };

function feed(id: string, title: string, kind: Feed["kind"], category: string | null, unreadCount = 1): Feed {
  return { id, url: `https://${id}.example/feed`, title, siteUrl: null, unreadCount, status: "ok", lastFetchedAt: null, lastError: null, errorCount: 0, category, kind };
}

describe("streams", () => {
  const streams: Stream[] = [
    { kind: "all" }, { kind: "feed", feedId: "f1" }, { kind: "list", listId: "l1" },
    { kind: "category", category: "Tech & Science" }, { kind: "type", feedKind: "podcast" },
  ];

  it("round-trips every stream through its path", () => {
    expect(streams.map((s) => streamPath(s, titles))).toEqual([
      "/", "/feeds/ars-technica--f1", "/lists/commute--l1", "/category/Tech%20%26%20Science", "/type/podcast",
    ]);
    expect(streamFromParams({})).toEqual({ kind: "all" });
    expect(streamFromParams({ feedId: "ars-technica--f1" })).toEqual(streams[1]);
    expect(streamFromParams({ listId: "commute--l1" })).toEqual(streams[2]);
    expect(streamFromParams({ feedCategory: "Tech & Science" })).toEqual(streams[3]);
    expect(streamFromParams({ feedKind: "podcast" })).toEqual(streams[4]);
    expect(streamFromParams({ feedKind: "books" })).toEqual({ kind: "all" });
    expect(new Set(streams.map(streamKey)).size).toBe(streams.length);
  });

  it("maps each stream onto article query filters and a title", () => {
    expect(streams.map(streamQuery)).toEqual([{}, { feedId: "f1" }, { listId: "l1" }, { feedCategory: "Tech & Science" }, { feedKind: "podcast" }]);
    expect(streams.map((s) => streamTitle(s, titles))).toEqual(["All items", "Ars Technica", "Commute", "Tech & Science", "Podcasts"]);
  });

  it("keeps an article inside a list, category or type, and under its feed otherwise", () => {
    const article = { id: "a1", feedId: "f1", title: "Hello World" };
    expect(streams.map((s) => streamArticlePath(s, article, titles))).toEqual([
      "/feeds/ars-technica--f1/articles/hello-world--a1",
      "/feeds/ars-technica--f1/articles/hello-world--a1",
      "/lists/commute--l1/articles/hello-world--a1",
      "/category/Tech%20%26%20Science/articles/hello-world--a1",
      "/type/podcast/articles/hello-world--a1",
    ]);
  });
});

describe("groupFeeds", () => {
  const feeds = [
    feed("f1", "Ars", "article", "Tech", 3), feed("f2", "Show", "podcast", "Tech", 2),
    feed("f3", "Blog", "article", null), feed("f4", "Tube", "video", "Art"),
  ];

  it("groups by category with uncategorized feeds last", () => {
    const groups = groupFeeds(feeds, "category");
    expect(groups.map((g) => [g.label, g.feeds.map((f) => f.title), g.unreadCount])).toEqual([
      ["Art", ["Tube"], 1], ["Tech", ["Ars", "Show"], 5], ["Uncategorized", ["Blog"], 1],
    ]);
    expect(groups.map((g) => g.stream)).toEqual([{ kind: "category", category: "Art" }, { kind: "category", category: "Tech" }, null]);
  });

  it("groups by kind in a fixed order, and not at all when grouping is off", () => {
    expect(groupFeeds(feeds, "type").map((g) => [g.label, g.feeds.length])).toEqual([["Articles", 2], ["Podcasts", 1], ["Video", 1]]);
    expect(groupFeeds(feeds, "none")).toEqual([]);
  });
});
