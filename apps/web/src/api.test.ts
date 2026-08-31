import { describe, it, expect, vi, beforeEach } from "vitest";
import { api, ApiError } from "./api";

beforeEach(() => vi.restoreAllMocks());

describe("api client", () => {
  it("builds article query params", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ articles: [], nextCursor: null }), { status: 200 }),
    );
    await api.listArticles({ feedId: "f1", category: "World", limit: 25 });
    expect(spy).toHaveBeenCalledWith("/api/v1/articles?feed_id=f1&category=World&limit=25", expect.anything());
  });

  it("builds keyset cursor params for infinite scroll", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ articles: [], nextCursor: null }), { status: 200 }),
    );
    await api.listArticles({ feedId: "f1", before: "2026-07-01T00:00:00Z", beforeId: "a2" });
    expect(spy).toHaveBeenCalledWith(
      "/api/v1/articles?feed_id=f1&before=2026-07-01T00%3A00%3A00Z&before_id=a2",
      expect.anything(),
    );
  });

  it("returns the article page with its cursor", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        articles: [{ id: "a1" }],
        nextCursor: { before: "2026-07-01T00:00:00Z", beforeId: "a1" },
      }), { status: 200 }),
    );
    const page = await api.listArticles();
    expect(page.articles).toHaveLength(1);
    expect(page.nextCursor).toEqual({ before: "2026-07-01T00:00:00Z", beforeId: "a1" });
  });

  it("omits the feed filter for all-feeds category counts", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ categories: [] }), { status: 200 }));
    await api.listCategories();
    expect(spy).toHaveBeenCalledWith("/api/v1/categories?", expect.anything());
    await api.listCategories("f1");
    expect(spy).toHaveBeenLastCalledWith("/api/v1/categories?feed_id=f1", expect.anything());
  });

  it("sends no content-type header on body-less calls", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await api.markAllRead("f1");
    const init = spy.mock.calls[0]![1] as RequestInit;
    expect(init.headers).toBeUndefined();
  });

  it("sends content-type header when a body is present", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await api.setRead("a1", true);
    expect(spy).toHaveBeenCalledWith(
      "/api/v1/articles/a1/read",
      expect.objectContaining({ headers: { "content-type": "application/json" } }),
    );
  });

  it("throws server error message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "duplicate", message: "already subscribed" } }), { status: 409 }),
    );
    await expect(api.subscribe("http://x")).rejects.toThrow("already subscribed");
  });

  it("subscribe maps network failures to ApiError code network", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    const err = await api.subscribe("http://x").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("network");
    expect(err.status).toBe(0);
    expect(err.message).toBe("network request failed");
  });

  it("subscribe returns choices on a 200 needsChoice response", async () => {
    const feeds = [
      { url: "http://x/feed.xml", title: "Main", kind: "rss" },
      { url: "http://x/atom.xml", title: "Atom", kind: "atom" },
    ];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ needsChoice: true, feeds }), { status: 200 }),
    );
    const result = await api.subscribe("http://x");
    expect(result).toEqual({ status: "choices", feeds });
  });

  it("ApiError carries code on 422", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "no_feeds_found", message: "no RSS or Atom feeds found at that URL" } }), { status: 422 }),
    );
    const err = await api.subscribe("http://x").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("no_feeds_found");
    expect(err.status).toBe(422);
    expect(err.message).toBe("no RSS or Atom feeds found at that URL");
  });
});
