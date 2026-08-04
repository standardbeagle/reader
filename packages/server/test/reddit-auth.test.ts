import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { redditAdapter } from "../src/ingestors/reddit.js";

let server: Server;
let baseUrl: string;
let tokenCalls: number;
let lastAuthHeader: string | null;
let lastTokenBody: string;

const LISTING = { data: { children: [{ data: { name: "t3_x1", title: "Post", selftext: "", author: "a", permalink: "/r/test/comments/x1/post/", url: "https://example.com", created_utc: 1783000000, is_self: false } }], after: null } };

async function start() {
  tokenCalls = 0;
  server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    if (u.pathname === "/api/v1/access_token") {
      tokenCalls++;
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        lastTokenBody = body;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ access_token: `tok-${tokenCalls}`, token_type: "bearer", expires_in: 3600 }));
      });
      return;
    }
    if (u.pathname.endsWith(".json")) {
      lastAuthHeader = req.headers.authorization ?? null;
      if (!lastAuthHeader?.startsWith("Bearer tok-")) { res.writeHead(401).end(); return; }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(LISTING));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
afterEach(async () => { await new Promise((r) => server.close(r)); });

describe("reddit oauth", () => {
  it("client_credentials grant: gets token, calls oauth base with bearer", async () => {
    await start();
    const cfg = { subreddit: "test", clientId: "cid", clientSecret: "sec", _baseUrl: baseUrl, _oauthBase: baseUrl, _tokenBase: baseUrl, _cacheKey: "rc1" };
    const result = await redditAdapter.fetch(cfg, null);
    expect(tokenCalls).toBe(1);
    expect(lastTokenBody).toContain("grant_type=client_credentials");
    expect(lastAuthHeader).toBe("Bearer tok-1");
    expect(result.items).toHaveLength(1);
  });

  it("password grant when username+password present", async () => {
    await start();
    const cfg = { subreddit: "test", clientId: "cid", clientSecret: "sec", username: "u", password: "p", _baseUrl: baseUrl, _oauthBase: baseUrl, _tokenBase: baseUrl, _cacheKey: "rc2" };
    await redditAdapter.fetch(cfg, null);
    expect(lastTokenBody).toContain("grant_type=password");
    expect(lastTokenBody).toContain("username=u");
  });

  it("caches token across fetches", async () => {
    await start();
    const cfg = { subreddit: "test", clientId: "cid", clientSecret: "sec", _baseUrl: baseUrl, _oauthBase: baseUrl, _tokenBase: baseUrl, _cacheKey: "rc3" };
    await redditAdapter.fetch(cfg, null);
    await redditAdapter.fetch(cfg, null);
    expect(tokenCalls).toBe(1);
  });
});
