import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "./api";

beforeEach(() => vi.restoreAllMocks());

describe("api client", () => {
  it("builds article query params", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ articles: [] }), { status: 200 }),
    );
    await api.listArticles({ feedId: "f1", unread: true });
    expect(spy).toHaveBeenCalledWith(
      "/api/v1/articles?feed_id=f1&unread=1",
      expect.objectContaining({ headers: { "content-type": "application/json" } }),
    );
  });

  it("throws server error message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "duplicate", message: "already subscribed" } }), { status: 409 }),
    );
    await expect(api.subscribe("http://x")).rejects.toThrow("already subscribed");
  });
});
