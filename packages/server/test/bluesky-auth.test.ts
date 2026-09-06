import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { blueskyAdapter } from "../src/ingestors/bluesky.js";
const testCtx: import("../src/ingestors/types.js").AdapterContext = { storage: {} as never, userId: "u1" };

let server: Server;
let baseUrl: string;
let authCalls: number;
let lastAuthHeader: string | null;

const FEED = {
  feed: [{ post: { uri: "at://did:plc:x/app.bsky.feed.post/abc", author: { handle: "bob.bsky.social" }, record: { text: "hello", createdAt: "2026-07-01T10:00:00Z" } } }],
  cursor: null,
};

async function start(opts: { failFirstSession?: boolean; rotatingTokens?: boolean } = {}) {
  authCalls = 0;
  server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    if (u.pathname === "/xrpc/com.atproto.server.createSession") {
      authCalls++;
      if (opts.failFirstSession && authCalls === 1) { res.writeHead(401).end(JSON.stringify({ error: "Unauthorized" })); return; }
      const token = opts.rotatingTokens ? `jwt-${authCalls}` : "jwt-1";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ accessJwt: token, refreshJwt: "refresh-1", did: "did:plc:x", handle: "me.bsky.social" }));
      return;
    }
    if (u.pathname.startsWith("/xrpc/app.bsky.")) {
      lastAuthHeader = req.headers.authorization ?? null;
      const valid = opts.rotatingTokens ? lastAuthHeader === "Bearer jwt-2" : lastAuthHeader === "Bearer jwt-1";
      if (!valid) { res.writeHead(401).end(JSON.stringify({ error: "ExpiredToken" })); return; }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(FEED));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => { await new Promise((r) => server.close(r)); });

describe("bluesky auth", () => {
  it("creates a session and sends bearer token on api calls", async () => {
    await start();
    const cfg = { search: "open source", identifier: "me.bsky.social", appPassword: "pw", _baseUrl: baseUrl, _authBase: baseUrl, _cacheKey: "auth-basic" };
    const result = await blueskyAdapter.fetch(cfg, null, testCtx);
    expect(authCalls).toBe(1);
    expect(lastAuthHeader).toBe("Bearer jwt-1");
    expect(result.items).toHaveLength(1);
  });

  it("caches the session across fetches", async () => {
    await start();
    const cfg = { search: "x", identifier: "me.bsky.social", appPassword: "pw", _baseUrl: baseUrl, _authBase: baseUrl, _cacheKey: "cache-test-1" };
    await blueskyAdapter.fetch(cfg, null, testCtx);
    await blueskyAdapter.fetch(cfg, null, testCtx);
    expect(authCalls).toBe(1);
  });

  it("re-auths once on 401 from the api", async () => {
    await start({ rotatingTokens: true });
    const cfg = { search: "x", identifier: "me.bsky.social", appPassword: "pw", _baseUrl: baseUrl, _authBase: baseUrl, _cacheKey: "reauth-test" };
    const result = await blueskyAdapter.fetch(cfg, null, testCtx);
    expect(authCalls).toBe(2);
    expect(result.items).toHaveLength(1);
  });

  it("throws on bad credentials", async () => {
    await start({ failFirstSession: true });
    const cfg = { search: "x", identifier: "me.bsky.social", appPassword: "wrong", _baseUrl: baseUrl, _authBase: baseUrl, _cacheKey: "bad-creds" };
    await expect(blueskyAdapter.fetch(cfg, null, testCtx)).rejects.toThrow(/bluesky auth failed/i);
  });
});
