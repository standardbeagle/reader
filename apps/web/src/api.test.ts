import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "./api";

beforeEach(() => vi.restoreAllMocks());

describe("api client", () => {
  it("builds article query params", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ articles: [] }), { status: 200 }),
    );
    await api.listArticles({ feedId: "f1", unread: true });
    expect(spy).toHaveBeenCalledWith("/api/v1/articles?feed_id=f1&unread=1", expect.anything());
  });

  it("sends no content-type header on body-less calls", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await api.markAllRead("f1");
    const init = spy.mock.calls[0][1] as RequestInit;
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
});
