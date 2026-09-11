import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createSqliteStorage } from "../src/storage/sqlite.js";
import type { Storage, CredentialSecret } from "../src/storage/types.js";
import { authorizationFor, describeCredential } from "../src/auth/credentials.js";

let storage: Storage;
let userId: string;
let tokenServer: Server;
let tokenUrl: string;
let tokenCalls: { body: string; auth: string | undefined }[];

beforeEach(async () => {
  storage = createSqliteStorage(":memory:");
  userId = storage.getOrCreateLocalUser().id;
  tokenCalls = [];
  tokenServer = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      tokenCalls.push({ body, auth: req.headers.authorization });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ access_token: `fresh-${tokenCalls.length}`, expires_in: 3600 }));
    });
  });
  await new Promise<void>((r) => tokenServer.listen(0, "127.0.0.1", r));
  tokenUrl = `http://127.0.0.1:${(tokenServer.address() as AddressInfo).port}/token`;
});

afterEach(async () => {
  storage.close();
  await new Promise((r) => tokenServer.close(r));
});

const ORIGIN = "https://feeds.example.com";

function oauth(overrides: Partial<Extract<CredentialSecret, { kind: "oauth2" }>> = {}): CredentialSecret {
  return {
    kind: "oauth2", tokenUrl, clientId: "cid", clientSecret: "csec",
    accessToken: "old", refreshToken: "rt", expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    ...overrides,
  };
}

const create = (secret: CredentialSecret) =>
  storage.createCredential(userId, { provider: "generic", label: "feeds.example.com", origin: ORIGIN, secret });

describe("credentials", () => {
  it("builds Basic and Bearer headers", async () => {
    const basic = create({ kind: "basic", username: "ann", password: "pw" });
    const bearer = create({ kind: "bearer", token: "tok" });
    expect(await authorizationFor(storage, basic.id, `${ORIGIN}/feed`)).toBe(`Basic ${Buffer.from("ann:pw").toString("base64")}`);
    expect(await authorizationFor(storage, bearer.id, `${ORIGIN}/feed`)).toBe("Bearer tok");
  });

  it("refuses to send a credential to another origin", async () => {
    const bearer = create({ kind: "bearer", token: "tok" });
    await expect(authorizationFor(storage, bearer.id, "https://evil.example.net/feed")).rejects.toThrow(/is for https:\/\/feeds\.example\.com/);
    await expect(authorizationFor(storage, bearer.id, "http://feeds.example.com/feed")).rejects.toThrow(/not http:/);
  });

  it("uses a valid OAuth token without refreshing", async () => {
    const cred = create(oauth());
    expect(await authorizationFor(storage, cred.id, `${ORIGIN}/feed`)).toBe("Bearer old");
    expect(tokenCalls).toHaveLength(0);
  });

  it("refreshes an expiring token once, persists it, and authenticates the client", async () => {
    const cred = create(oauth({ expiresAt: new Date(Date.now() + 10_000).toISOString() }));
    const [a, b] = await Promise.all([
      authorizationFor(storage, cred.id, `${ORIGIN}/a`),
      authorizationFor(storage, cred.id, `${ORIGIN}/b`),
    ]);
    expect([a, b]).toEqual(["Bearer fresh-1", "Bearer fresh-1"]);
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0]!.body).toBe("grant_type=refresh_token&refresh_token=rt");
    expect(tokenCalls[0]!.auth).toBe(`Basic ${Buffer.from("cid:csec").toString("base64")}`);
    const stored = storage.getCredential(cred.id)!.secret;
    expect(stored).toMatchObject({ accessToken: "fresh-1", refreshToken: "rt" });
  });

  it("sends client_id in the body for a public client and refreshes on demand", async () => {
    const cred = create(oauth({ clientSecret: null }));
    expect(await authorizationFor(storage, cred.id, `${ORIGIN}/feed`, { forceRefresh: true })).toBe("Bearer fresh-1");
    expect(tokenCalls[0]!.auth).toBeUndefined();
    expect(tokenCalls[0]!.body).toContain("client_id=cid");
  });

  it("fails with a reconnect hint when an expired token has no refresh token", async () => {
    const cred = create(oauth({ refreshToken: null, expiresAt: new Date(Date.now() - 1000).toISOString() }));
    await expect(authorizationFor(storage, cred.id, `${ORIGIN}/feed`)).rejects.toThrow(/reconnect/);
  });

  it("never exposes the secret and refuses deletion while a feed uses it", () => {
    const cred = create({ kind: "bearer", token: "tok" });
    expect(describeCredential(cred)).not.toHaveProperty("secret");
    expect(describeCredential(cred)).toMatchObject({ kind: "bearer", label: "feeds.example.com", origin: ORIGIN });
    const feed = storage.createFeed(userId, { url: `${ORIGIN}/feed`, title: "F", siteUrl: null, credentialId: cred.id });
    expect(storage.getFeed(feed.id)!.credentialId).toBe(cred.id);
    expect(() => storage.deleteCredential(cred.id)).toThrow(/FOREIGN KEY/);
    storage.deleteFeed(feed.id);
    storage.deleteCredential(cred.id);
    expect(storage.getCredential(cred.id)).toBeNull();
  });
});
