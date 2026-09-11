import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mastodonAdapter } from "../src/ingestors/mastodon.js";
import { blueskyAdapter } from "../src/ingestors/bluesky.js";
import { redditAdapter } from "../src/ingestors/reddit.js";
const testCtx: import("../src/ingestors/types.js").AdapterContext = { storage: {} as never, userId: "u1" };

type Handler = (u: URL) => unknown;

let handler: Handler = () => null;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  handler = () => null;
  server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    const out = handler(u);
    if (out === null || out === undefined) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(out));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => { await new Promise((r) => server.close(r)); });

function serveRoutes(routes: Record<string, unknown>) {
  handler = (u) => (u.pathname in routes ? routes[u.pathname] : null);
}

describe("mastodon adapter", () => {
  const timeline = [
    { id: "101", created_at: "2026-07-01T12:00:00Z", url: "https://mastodon.social/@a/101", content: "<p>Hello <b>world</b></p>", account: { acct: "alice@mastodon.social" } },
    { id: "100", created_at: "2026-06-30T12:00:00Z", url: "https://mastodon.social/@a/100", content: "<p>Earlier</p>", account: { acct: "alice@mastodon.social" } },
  ];
  it("fetches a tag timeline, strips html, and cursors forward by min_id", async () => {
    let sawMinId: string | null = null;
    let page: typeof timeline = timeline;
    handler = (u) => {
      if (u.pathname !== "/api/v1/timelines/tag/ai") return null;
      sawMinId = u.searchParams.get("min_id");
      return page;
    };
    const cfg = { instance: new URL(baseUrl).host, tag: "ai", _baseUrl: baseUrl };
    const first = await mastodonAdapter.fetch(cfg, null, testCtx);
    expect(sawMinId).toBeNull();
    expect(first.items).toHaveLength(2);
    expect(first.items[0]!.text).toBe("Hello world");
    expect(first.items[0]!.author).toBe("alice@mastodon.social");
    expect(first.cursor).toEqual({ minId: "101" });
    page = [{ ...timeline[0]!, id: "1000" }];
    const second = await mastodonAdapter.fetch(cfg, first.cursor, testCtx);
    expect(sawMinId).toBe("101");
    expect(second.cursor).toEqual({ minId: "1000" });
    page = [];
    expect((await mastodonAdapter.fetch(cfg, second.cursor, testCtx)).cursor).toEqual({ minId: "1000" });
  });
});

describe("bluesky adapter", () => {
  const feed = {
    feed: [
      { post: { uri: "at://did:plc:x/app.bsky.feed.post/abc", cid: "c1", author: { handle: "bob.bsky.social" }, record: { text: "shipping today", createdAt: "2026-07-01T10:00:00Z" } } },
    ],
    cursor: "page2",
  };
  it("fetches author feed and normalizes urls", async () => {
    serveRoutes({ "/xrpc/app.bsky.feed.getAuthorFeed": feed });
    const cfg = { handle: "bob.bsky.social", _baseUrl: baseUrl };
    const result = await blueskyAdapter.fetch(cfg, null, testCtx);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.externalId).toBe("at://did:plc:x/app.bsky.feed.post/abc");
    expect(result.items[0]!.url).toBe("https://bsky.app/profile/bob.bsky.social/post/abc");
    expect(result.items[0]!.text).toBe("shipping today");
    expect(result.cursor).toEqual({ cursor: "page2" });
  });
});

describe("reddit adapter", () => {
  const listing = {
    data: {
      children: [
        { data: { name: "t3_aaa", title: "Big news", selftext: "body", author: "carol", permalink: "/r/technology/comments/aaa/big_news/", url: "https://example.com/story", created_utc: 1783000000, score: 42 } },
      ],
      after: "t3_aaa",
    },
  };
  it("fetches subreddit listing and normalizes", async () => {
    serveRoutes({ "/r/technology/new.json": listing });
    const cfg = { subreddit: "technology", _baseUrl: baseUrl };
    const result = await redditAdapter.fetch(cfg, null, testCtx);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.externalId).toBe("t3_aaa");
    expect(result.items[0]!.title).toBe("Big news");
    expect(result.items[0]!.text).toContain("body");
    expect(result.items[0]!.url).toBe("https://example.com/story");
    expect(result.cursor).toEqual({ after: "t3_aaa" });
  });
});
