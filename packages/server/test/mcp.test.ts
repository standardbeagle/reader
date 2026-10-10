import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Server } from "node:http";
import type { FastifyInstance } from "fastify";
import { createServer } from "../src/api/server.js";
import { startFixtureServer } from "./fixtureServer.js";

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
<title>Show</title><link>https://show.example.com</link>
<item><title>Ep 1</title><link>https://show.example.com/1</link><guid>e1</guid>
<pubDate>Wed, 01 Jul 2026 12:00:00 GMT</pubDate><description>&lt;p&gt;first &lt;b&gt;episode&lt;/b&gt;&lt;/p&gt;</description>
<enclosure url="https://show.example.com/1.mp3" type="audio/mpeg" length="1"/></item>
<item><title>Ep 2</title><link>https://show.example.com/2</link><guid>e2</guid>
<pubDate>Thu, 02 Jul 2026 12:00:00 GMT</pubDate><description>second</description>
<enclosure url="https://show.example.com/2.mp3" type="audio/mpeg" length="1"/></item>
</channel></rss>`;

let app: FastifyInstance;
let fixture: Server;
let baseUrl: string;
let nextId = 1;

beforeEach(async () => {
  ({ server: fixture, baseUrl } = await startFixtureServer({ "/feed.xml": { xml: RSS } }));
  app = await createServer({ dbPath: ":memory:", poller: false });
  await app.ready();
});
afterEach(async () => {
  await app.close();
  await new Promise((r) => fixture.close(r));
});

const rpc = (method: string, params?: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: "POST", url: "/mcp", headers, payload: { jsonrpc: "2.0", id: nextId++, method, ...(params !== undefined ? { params } : {}) } });

/** Call a tool and return its parsed answer, or its error text. */
async function tool(name: string, args: object = {}): Promise<{ ok: boolean; value: any }> {
  const res = (await rpc("tools/call", { name, arguments: args })).json();
  const text = res.result.content[0].text as string;
  return res.result.isError ? { ok: false, value: text } : { ok: true, value: JSON.parse(text) };
}

describe("mcp endpoint", () => {
  it("speaks the initialize / tools handshake", async () => {
    const init = (await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } })).json();
    expect(init.result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "reader" } });
    const future = (await rpc("initialize", { protocolVersion: "2999-01-01" })).json();
    expect(future.result.protocolVersion).toBe("2025-11-25");

    const note = await app.inject({ method: "POST", url: "/mcp", payload: { jsonrpc: "2.0", method: "notifications/initialized" } });
    expect(note.statusCode).toBe(202);
    expect((await rpc("ping")).json().result).toEqual({});

    const tools = (await rpc("tools/list")).json().result.tools as { name: string; inputSchema: { type: string } }[];
    expect(tools.map((t) => t.name)).toContain("list_set_items");
    expect(tools.every((t) => t.inputSchema.type === "object")).toBe(true);
  });

  it("refuses what it cannot serve", async () => {
    expect((await rpc("resources/list")).json().error.code).toBe(-32601);
    expect((await app.inject({ method: "POST", url: "/mcp", payload: [{ jsonrpc: "2.0", id: 1, method: "ping" }] })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/mcp", payload: { id: 1, method: "ping" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/mcp" })).statusCode).toBe(405);
    expect((await rpc("ping", undefined, { origin: "https://evil.example" })).statusCode).toBe(403);
    expect((await rpc("ping", undefined, { origin: "http://reader.test:3737", host: "reader.test:3737" })).statusCode).toBe(200);
  });

  it("curates a playlist end to end through tools", async () => {
    await app.inject({ method: "POST", url: "/api/v1/feeds", payload: { url: `${baseUrl}/feed.xml` } });

    const feeds = (await tool("feeds_list")).value.feeds;
    expect(feeds).toHaveLength(1);
    expect(feeds[0]).toMatchObject({ title: "Show", kind: "podcast", category: null, unreadCount: 2 });
    expect((await tool("feed_set_category", { feedId: feeds[0].id, category: "Shows" })).value.category).toBe("Shows");

    const page = (await tool("articles_list", { feedCategory: "Shows", media: "audio", limit: 1 })).value;
    expect(page.articles).toEqual([expect.objectContaining({ title: "Ep 2", media: "audio", read: false })]);
    const rest = (await tool("articles_list", { feedCategory: "Shows", limit: 1, cursor: page.nextCursor })).value;
    expect(rest.articles.map((a: { title: string }) => a.title)).toEqual(["Ep 1"]);
    const [ep2, ep1] = [page.articles[0].id, rest.articles[0].id];

    const read = (await tool("article_get", { articleId: ep1 })).value;
    expect(read).toMatchObject({ title: "Ep 1", text: "first episode", truncated: false, listIds: [] });

    const list = (await tool("list_create", { title: "Commute" })).value;
    expect((await tool("list_set_items", { listId: list.id, articleIds: [ep1, ep2] })).ok).toBe(true);
    const ordered = (await tool("articles_list", { listId: list.id })).value;
    expect(ordered.articles.map((a: { title: string }) => a.title)).toEqual(["Ep 1", "Ep 2"]);
    await tool("list_remove_items", { listId: list.id, articleIds: [ep1] });
    await tool("list_add_items", { listId: list.id, articleIds: [ep1] });
    expect((await tool("articles_list", { listId: list.id })).value.articles.map((a: { title: string }) => a.title)).toEqual(["Ep 2", "Ep 1"]);

    const dynamic = (await tool("list_create", { title: "Unplayed", rule: { media: "audio", unreadOnly: true } })).value;
    await tool("article_set_read", { articleId: ep2, read: true });
    expect((await tool("articles_list", { listId: dynamic.id })).value.articles.map((a: { title: string }) => a.title)).toEqual(["Ep 1"]);
    const lists = (await tool("lists_list")).value.lists;
    expect(lists.map((l: { title: string; itemCount: number }) => [l.title, l.itemCount])).toEqual([["Commute", 2], ["Unplayed", 1]]);

    expect((await tool("list_update", { listId: dynamic.id, title: "Queue", rule: { feedKind: "podcast" } })).value).toMatchObject({ title: "Queue", rule: { feedKind: "podcast" } });
    expect((await tool("list_delete", { listId: list.id })).ok).toBe(true);
  });

  it("reports bad tool input as a tool error the model can read", async () => {
    expect(await tool("no_such_tool")).toEqual({ ok: false, value: "unknown tool: no_such_tool" });
    expect((await tool("article_get")).value).toMatch(/articleId is required/);
    expect((await tool("article_get", { articleId: "nope" })).value).toMatch(/^not_found:/);
    expect((await tool("article_set_read", { articleId: "nope", read: true })).value).toMatch(/^not_found:/);
    expect((await tool("articles_list", { limit: 5000 })).value).toMatch(/limit must be/);
    expect((await tool("articles_list", { media: "gif" })).value).toMatch(/^invalid_filter:/);
    expect((await tool("list_create", { title: "x", rule: { nope: 1 } })).value).toMatch(/^invalid_rule: unknown rule field: nope/);
    expect((await tool("list_set_items", { listId: "nope", articleIds: [] })).value).toMatch(/^not_found:/);
    expect((await tool("list_set_items", { listId: "x", articleIds: "all" })).value).toMatch(/articleIds must be/);
  });
});
