import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { redditAdapter } from "../src/ingestors/reddit.js";
import { createSqliteStorage } from "../src/storage/sqlite.js";
import type { Storage } from "../src/storage/types.js";
import type { AdapterContext } from "../src/ingestors/types.js";

let server: Server;
let baseUrl: string;
let tokenCalls: number;
let listingAuth: (string | undefined)[];
/** The access token the fake API currently accepts. */
let validToken: string;
let storage: Storage;
let ctx: AdapterContext;

const LISTING = { data: { children: [{ data: { name: "t3_x1", title: "Post", selftext: "", author: "a", permalink: "/r/test/comments/x1/post/", url: "https://example.com", created_utc: 1783000000, is_self: false } }], after: null } };

beforeEach(async () => {
  tokenCalls = 0;
  listingAuth = [];
  validToken = "at-0";
  server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    if (u.pathname === "/api/v1/access_token") {
      tokenCalls++;
      validToken = `at-${tokenCalls}`;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ access_token: validToken, expires_in: 3600 }));
      return;
    }
    if (u.pathname.endsWith(".json")) {
      listingAuth.push(req.headers.authorization);
      if (req.headers.authorization !== `Bearer ${validToken}`) { res.writeHead(401).end(); return; }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(LISTING));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  storage = createSqliteStorage(":memory:");
  ctx = { storage, userId: storage.getOrCreateLocalUser().id };
});

afterEach(async () => {
  storage.close();
  await new Promise((r) => server.close(r));
});

function connect(accessToken: string, expiresInMs: number) {
  return storage.createCredential(ctx.userId, {
    provider: "reddit", label: "u/ann", origin: baseUrl,
    secret: {
      kind: "oauth2", tokenUrl: `${baseUrl}/api/v1/access_token`, clientId: "cid", clientSecret: "sec",
      accessToken, refreshToken: "rt", expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
    },
  });
}

describe("reddit with a connected account", () => {
  it("reads the OAuth API with the account's token", async () => {
    const cred = connect("at-0", 3_600_000);
    const result = await redditAdapter.fetch({ subreddit: "test", credentialId: cred.id, _oauthBase: baseUrl }, null, ctx);
    expect(listingAuth).toEqual(["Bearer at-0"]);
    expect(tokenCalls).toBe(0);
    expect(result.items).toHaveLength(1);
  });

  it("refreshes an expired token before fetching", async () => {
    const cred = connect("at-stale", -1000);
    await redditAdapter.fetch({ subreddit: "test", credentialId: cred.id, _oauthBase: baseUrl }, null, ctx);
    expect(tokenCalls).toBe(1);
    expect(listingAuth).toEqual(["Bearer at-1"]);
  });

  it("force-refreshes and retries once when the API rejects a live token", async () => {
    const cred = connect("at-revoked", 3_600_000);
    const result = await redditAdapter.fetch({ subreddit: "test", credentialId: cred.id, _oauthBase: baseUrl }, null, ctx);
    expect(listingAuth).toEqual(["Bearer at-revoked", "Bearer at-1"]);
    expect(result.items).toHaveLength(1);
  });

  it("rejects the old inline secrets", async () => {
    await expect(redditAdapter.validate({ subreddit: "test", clientId: "c", clientSecret: "s" }, ctx)).rejects.toThrow(/connect a Reddit account/);
    await expect(redditAdapter.validate({ subreddit: "test" }, ctx)).resolves.toBe("r/test");
  });
});
