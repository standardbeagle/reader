import { describe, expect, it } from "vitest";
import type { Article } from "./api";
import { navNeighbor } from "./articleNav";

function article(id: string, read: boolean): Article {
  return {
    id,
    feedId: "f1",
    title: `Article ${id}`,
    url: null,
    author: null,
    publishedAt: null,
    contentHtml: null,
    summary: null,
    readAt: read ? "2026-09-01T00:00:00Z" : null,
  };
}

// Order matches the list: index 0 is the newest.
const list = [article("a", true), article("b", false), article("c", true), article("d", false)];

describe("navNeighbor", () => {
  it("returns the immediate neighbor when unreadOnly is off", () => {
    expect(navNeighbor(list, 1, "prev", false)?.id).toBe("a");
    expect(navNeighbor(list, 1, "next", false)?.id).toBe("c");
  });

  it("skips read articles when unreadOnly is on", () => {
    expect(navNeighbor(list, 1, "next", true)?.id).toBe("d");
    expect(navNeighbor(list, 3, "prev", true)?.id).toBe("b");
  });

  it("returns the adjacent article when it is already unread", () => {
    expect(navNeighbor(list, 0, "next", true)?.id).toBe("b");
  });

  it("returns null when nothing unread remains in that direction", () => {
    expect(navNeighbor(list, 3, "next", true)).toBeNull();
    expect(navNeighbor(list, 1, "prev", true)).toBeNull();
  });

  it("returns null at the list edges and for no selection", () => {
    expect(navNeighbor(list, 0, "prev", false)).toBeNull();
    expect(navNeighbor(list, 3, "next", false)).toBeNull();
    expect(navNeighbor(list, -1, "next", false)).toBeNull();
    expect(navNeighbor([], 0, "next", false)).toBeNull();
  });
});
