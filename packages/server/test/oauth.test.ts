import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { createServer } from "../src/api/server.js";
import { createSqliteStorage } from "../src/storage/sqlite.js";
import type { Storage } from "../src/storage/types.js";
import { completeFlow, startMastodonFlow, startRedditFlow } from "../src/auth/oauth.js";

/** A fake provider: Mastodon app registration, a token endpoint, and account lookups. */
let provider: Server;
let base: string;
let tokenForms: URLSearchParams[];
let challenge: string | null;

beforeEach(async () => {
  tokenForms = [];
  challenge = null;
  provider = createHttpServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://x");
      const json = (status: number, data: unknown) => { res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(data)); };
      if (url.pathname === "/api/v1/apps") return json(200, { client_id: "masto-id", client_secret: "masto-secret" });
      if (url.pathname === "/oauth/token" || url.pathname === "/token") {
        const form = new URLSearchParams(body);
        tokenForms.push(form);
        if (challenge !== null) {
          const verifier = form.get("code_verifier") ?? "";
          if (createHash("sha256").update(verifier).digest("base64url") !== challenge) return json(400, { error: "invalid_grant" });
        }
        return json(200, { access_token: "at-1", refresh_token: "rt-1", expires_in: 3600 });
      }
      if (req.headers.authorization !== "Bearer at-1") return json(401, {});
      if (url.pathname === "/api/v1/accounts/verify_credentials") return json(200, { acct: "ann" });
      if (url.pathname === "/api/v1/me") return json(200, { name: "ann_r" });
      json(404, {});
    });
  });
  await new Promise<void>((r) => provider.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((r) => provider.close(r));
});

describe("oauth flows", () => {
  let storage: Storage;
  let userId: string;
  beforeEach(() => {
    storage = createSqliteStorage(":memory:");
    userId = storage.getOrCreateLocalUser().id;
  });
  afterEach(() => storage.close());

  it("registers with a Mastodon instance and stores a non-expiring account token", async () => {
    const authorize = new URL(await startMastodonFlow(userId, base, "http://127.0.0.1:3737/api/v1/oauth/callback"));
    expect(authorize.origin + authorize.pathname).toBe(`${base}/oauth/authorize`);
    expect(authorize.searchParams.get("client_id")).toBe("masto-id");
    expect(authorize.searchParams.get("scope")).toBe("read");
    const cred = await completeFlow(storage, authorize.searchParams.get("state")!, "the-code");
    expect(tokenForms[0]!.get("code")).toBe("the-code");
    expect(tokenForms[0]!.get("redirect_uri")).toBe("http://127.0.0.1:3737/api/v1/oauth/callback");
    expect(cred).toMatchObject({ provider: "mastodon", label: `@ann@${new URL(base).host}`, origin: base });
    expect(cred.secret).toMatchObject({ kind: "oauth2", accessToken: "at-1", clientSecret: "masto-secret" });
  });

  it("asks Reddit for a permanent grant and binds the credential to the API origin", async () => {
    const authorize = new URL(startRedditFlow(userId, { clientId: "rid", clientSecret: "rsec" }, "http://x/cb", {
      authorizeUrl: `${base}/authorize`, tokenUrl: `${base}/token`, apiBase: base,
    }));
    expect(authorize.searchParams.get("duration")).toBe("permanent");
    const cred = await completeFlow(storage, authorize.searchParams.get("state")!, "c");
    expect(cred).toMatchObject({ provider: "reddit", label: "u/ann_r", origin: base });
    expect(cred.secret).toMatchObject({ refreshToken: "rt-1" });
  });

  it("uses each state once", async () => {
    const state = new URL(await startMastodonFlow(userId, base, "http://x/cb")).searchParams.get("state")!;
    await completeFlow(storage, state, "c");
    await expect(completeFlow(storage, state, "c")).rejects.toThrow(/expired or was already used/);
    await expect(completeFlow(storage, "made-up", "c")).rejects.toThrow(/expired or was already used/);
  });
});

describe("oauth routes", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await createServer({ dbPath: ":memory:", poller: false });
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  const startGeneric = (headers: Record<string, string>) => app.inject({
    method: "POST", url: "/api/v1/oauth/start", headers,
    payload: { provider: "generic", feedUrl: "https://private.example.com/feed.xml", authorizeUrl: `${base}/authorize`, tokenUrl: `${base}/token`, clientId: "gid" },
  });

  it("runs a PKCE sign-in end to end and reports back to the opener", async () => {
    const started = await startGeneric({ origin: "http://127.0.0.1:3737" });
    expect(started.statusCode).toBe(200);
    const authorize = new URL(started.json().authorizeUrl);
    expect(authorize.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:3737/api/v1/oauth/callback");
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    challenge = authorize.searchParams.get("code_challenge");

    const callback = await app.inject({ method: "GET", url: `/api/v1/oauth/callback?state=${authorize.searchParams.get("state")}&code=c1` });
    expect(callback.statusCode).toBe(200);
    expect(callback.headers["cache-control"]).toBe("no-store");
    expect(callback.body).toContain('"type":"reader-oauth","ok":true');
    expect(callback.body).not.toContain("at-1");
    expect(tokenForms[0]!.get("client_id")).toBe("gid");

    const list = (await app.inject({ method: "GET", url: "/api/v1/credentials" })).json().credentials;
    expect(list).toEqual([expect.objectContaining({ provider: "generic", kind: "oauth2", label: "private.example.com", origin: "https://private.example.com", usedBy: 0 })]);
    expect(JSON.stringify(list)).not.toContain("rt-1");
  });

  it("requires an Origin to build the redirect URI", async () => {
    const res = await startGeneric({});
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("oauth_origin_required");
  });

  it("escapes provider errors on the callback page", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/oauth/callback?error=access_denied&error_description=${encodeURIComponent("</script><b>x")}` });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain("</script><b>");
    expect(res.body).toContain("&lt;/script&gt;&lt;b&gt;x");
  });

  it("creates basic credentials bound to the feed origin and deletes unused ones", async () => {
    const created = await app.inject({ method: "POST", url: "/api/v1/credentials", payload: { kind: "basic", url: "https://private.example.com/feed.xml", username: "ann", password: "pw" } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ kind: "basic", origin: "https://private.example.com", label: "private.example.com" });
    expect(created.body).not.toContain("pw");
    const bad = await app.inject({ method: "POST", url: "/api/v1/credentials", payload: { kind: "basic", url: "ftp://x", username: "a", password: "b" } });
    expect(bad.statusCode).toBe(400);
    const del = await app.inject({ method: "DELETE", url: `/api/v1/credentials/${created.json().id}` });
    expect(del.statusCode).toBe(204);
  });
});
