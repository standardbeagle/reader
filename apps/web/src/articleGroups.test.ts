import { describe, it, expect } from "vitest";
import { groupByDay } from "./ArticleList";
import type { Article } from "./api";

function article(id: string, publishedAt: string | null): Article {
  return {
    id, feedId: "f1", title: `T-${id}`, url: null, author: null,
    publishedAt, contentHtml: null, summary: null, readAt: null,
  };
}

describe("groupByDay", () => {
  const now = new Date(2026, 7, 31, 12, 0, 0);

  it("labels today and yesterday relative to now", () => {
    const groups = groupByDay([
      article("a", new Date(2026, 7, 31, 9).toISOString()),
      article("b", new Date(2026, 7, 30, 22).toISOString()),
    ], now);
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday"]);
  });

  it("keeps date order, merges same-day items, and parks undated last", () => {
    const groups = groupByDay([
      article("a", new Date(2026, 7, 30).toISOString()),
      article("b", new Date(2026, 7, 30).toISOString()),
      article("c", new Date(2026, 6, 2).toISOString()),
      article("d", null),
      article("e", null),
    ], now);
    expect(groups.map((g) => g.key)).toEqual(["2026-7-30", "2026-6-2", "earlier"]);
    expect(groups[0]!.items.map((a) => a.id)).toEqual(["a", "b"]);
    expect(groups[2]!.label).toBe("Earlier");
    expect(groups[2]!.items).toHaveLength(2);
  });

  it("includes the year for older dates", () => {
    const groups = groupByDay([article("a", new Date(2024, 0, 5).toISOString())], now);
    expect(groups[0]!.label).toContain("2024");
  });
});
