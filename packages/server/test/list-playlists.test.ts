import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createServer } from "../src/api/server.js";
import { createSqliteStorage } from "../src/storage/sqlite.js";
import type { Storage } from "../src/storage/types.js";
import type { ParsedArticle } from "@reader/core";

const identity = (html: string) => html;

function article(guid: string, day: number, extra: Partial<ParsedArticle> = {}): ParsedArticle {
  return {
    guid, url: `https://example.com/${guid}`, title: guid, author: null,
    publishedAt: new Date(Date.UTC(2026, 6, day, 12)), contentHtml: "<p>x</p>", summary: null, ...extra,
  };
}

describe("list playlists (storage)", () => {
  let storage: Storage;
  let userId: string;
  let ids: Record<string, string>;
  let podId: string;
  beforeEach(() => {
    storage = createSqliteStorage(":memory:");
    userId = storage.getOrCreateLocalUser().id;
    const blog = storage.createFeed(userId, { url: "https://blog.example.com/feed", title: "Blog", siteUrl: null });
    const pod = storage.createFeed(userId, { url: "https://pod.example.com/feed", title: "Pod", siteUrl: null, category: "Shows" });
    podId = pod.id;
    const made = [
      ...storage.upsertArticles(blog.id, [article("b1", 1), article("b2", 2)], identity),
      ...storage.upsertArticles(pod.id, [
        article("p1", 3, { media: { url: "https://pod.example.com/1.mp3", type: "audio/mpeg" } }),
        article("p2", 4, { media: { url: "https://pod.example.com/2.mp3", type: "audio/mpeg" } }),
      ], identity),
    ];
    ids = Object.fromEntries(made.map((a) => [a.title, a.id]));
  });
  afterEach(() => storage.close());

  const titles = (listId: string, extra: object = {}) =>
    storage.listArticles({ userId, listId, limit: 50, ...extra }).map((a) => a.title);

  it("plays a manual list in the order articles were added, not by date", () => {
    const list = storage.createList(userId, { title: "Queue", visibility: "private" });
    for (const t of ["p2", "b1", "p1"]) storage.addToList(list.id, ids[t]!);
    expect(titles(list.id)).toEqual(["p2", "b1", "p1"]);
    expect(titles(list.id, { order: "newest" })).toEqual(["p2", "p1", "b1"]);
  });

  it("replaces and reorders a manual list atomically", () => {
    const list = storage.createList(userId, { title: "Queue", visibility: "private" });
    storage.addToList(list.id, ids.b1!);
    storage.setListItems(list.id, [ids.p1!, ids.b2!, ids.b1!, ids.p1!]);
    expect(titles(list.id)).toEqual(["p1", "b2", "b1"]);
    storage.addToList(list.id, ids.p2!);
    expect(titles(list.id)).toEqual(["p1", "b2", "b1", "p2"]);
    expect(storage.listLists(userId)[0]!.itemCount).toBe(4);
    expect(() => storage.setListItems(list.id, [ids.b1!, "no-such-article"])).toThrow();
    expect(titles(list.id)).toEqual(["p1", "b2", "b1", "p2"]);
  });

  it("pages a manual list by position without skipping or repeating", () => {
    const list = storage.createList(userId, { title: "Queue", visibility: "private" });
    storage.setListItems(list.id, [ids.b2!, ids.p1!, ids.b1!, ids.p2!]);
    const seen: string[] = [];
    let cursor: { before?: string; beforeId?: string } = {};
    for (;;) {
      const page = storage.listArticlePage({ userId, listId: list.id, limit: 3, ...cursor });
      seen.push(...page.articles.map((a) => a.title));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(["b2", "p1", "b1", "p2"]);
  });

  it("resolves a dynamic list from its rule on every read", () => {
    const list = storage.createList(userId, { title: "Unplayed", visibility: "private", rule: { media: "audio", unreadOnly: true, order: "oldest" } });
    expect(titles(list.id)).toEqual(["p1", "p2"]);
    expect(storage.listLists(userId)[0]!).toMatchObject({ itemCount: 2, rule: { media: "audio" } });

    storage.setRead(userId, ids.p1!, true);
    expect(titles(list.id)).toEqual(["p2"]);
    storage.upsertArticles(podId, [article("p3", 5, { media: { url: "https://pod.example.com/3.mp3", type: "audio/mpeg" } })], identity);
    expect(titles(list.id)).toEqual(["p2", "p3"]);
    expect(storage.listLists(userId)[0]!.itemCount).toBe(2);

    const shows = storage.updateList(list.id, { title: "Shows", rule: { feedCategory: "Shows" } });
    expect(shows).toMatchObject({ title: "Shows", rule: { feedCategory: "Shows" } });
    expect(titles(list.id)).toEqual(["p3", "p2", "p1"]);
    expect(storage.listListArticles(list.id, 10).map((a) => a.title)).toEqual(["p3", "p2", "p1"]);
  });
});

describe("list playlists (api)", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await createServer({ dbPath: ":memory:", poller: false });
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  const post = (url: string, payload: unknown) => app.inject({ method: "POST", url, payload: payload as object });

  it("creates dynamic lists and refuses rules it cannot honor", async () => {
    const made = await post("/api/v1/lists", { title: "Videos", rule: { media: "video", maxAgeDays: 30 } });
    expect(made.statusCode).toBe(201);
    expect(made.json().rule).toEqual({ media: "video", maxAgeDays: 30 });

    for (const rule of [{ media: "gif" }, { meda: "video" }, { feedIds: ["nope"] }, { maxAgeDays: 0 }, { unreadOnly: "yes" }, "video", []]) {
      const bad = await post("/api/v1/lists", { title: "Bad", rule });
      expect(bad.statusCode, JSON.stringify(rule)).toBe(400);
      expect(bad.json().error.code).toBe("invalid_rule");
    }
  });

  it("keeps manual and dynamic lists apart", async () => {
    const dynamic = (await post("/api/v1/lists", { title: "Videos", rule: { media: "video" } })).json();
    const manual = (await post("/api/v1/lists", { title: "Queue" })).json();

    const add = await post(`/api/v1/lists/${dynamic.id}/items`, { articleId: "x" });
    expect(add.statusCode).toBe(409);
    expect(add.json().error.code).toBe("list_dynamic");
    const set = await app.inject({ method: "PUT", url: `/api/v1/lists/${dynamic.id}/items`, payload: { articleIds: [] } });
    expect(set.statusCode).toBe(409);

    const toDynamic = await app.inject({ method: "PATCH", url: `/api/v1/lists/${manual.id}`, payload: { rule: { media: "audio" } } });
    expect(toDynamic.statusCode).toBe(409);
    expect(toDynamic.json().error.code).toBe("list_manual");

    const renamed = await app.inject({ method: "PATCH", url: `/api/v1/lists/${dynamic.id}`, payload: { title: "Watch", rule: { media: "video", unreadOnly: true } } });
    expect(renamed.json()).toMatchObject({ title: "Watch", rule: { media: "video", unreadOnly: true } });

    const unknown = await app.inject({ method: "PUT", url: `/api/v1/lists/${manual.id}/items`, payload: { articleIds: ["nope"] } });
    expect(unknown.statusCode).toBe(404);
    const notArray = await app.inject({ method: "PUT", url: `/api/v1/lists/${manual.id}/items`, payload: { articleIds: "nope" } });
    expect(notArray.statusCode).toBe(400);
    const emptied = await app.inject({ method: "PUT", url: `/api/v1/lists/${manual.id}/items`, payload: { articleIds: [] } });
    expect(emptied.statusCode).toBe(204);

    const stray = await app.inject({ method: "GET", url: "/api/v1/articles?order=position" });
    expect(stray.statusCode).toBe(400);
    const inList = await app.inject({ method: "GET", url: `/api/v1/articles?order=position&list_id=${manual.id}` });
    expect(inList.statusCode).toBe(200);
  });
});
