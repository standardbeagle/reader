# Reader M2.1 — Authenticated ingestor adapters Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Authenticated access for Bluesky (app password via createSession) and Reddit (OAuth client_credentials / script password grant) so ingestors work from datacenter IPs that anonymous endpoints block.

**Design:** Adapters gain optional credential config fields with env-var fallback. Token caches (module-level Map keyed by identity) hold session/bearer tokens with expiry; a single 401 triggers one re-auth retry. Credentials resolution order: ingestor config field → env var → anonymous. Env names: `BLUESKY_IDENTIFIER`, `BLUESKY_APP_PASSWORD`, `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USERNAME`, `REDDIT_PASSWORD`. Secrets never logged; error paths must not include response bodies from auth endpoints.

**Conventions:** tests/build via `tman run -- <cmd>`; conventional commits; no comments unless asked; no placeholders. Fixture servers only, no network mocks.

---

### Task 1: Bluesky auth

**Files:**
- Modify: `packages/server/src/ingestors/bluesky.ts`
- Create: `packages/server/test/bluesky-auth.test.ts`

- [ ] **Step 1: Failing tests**

`packages/server/test/bluesky-auth.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { blueskyAdapter } from "../src/ingestors/bluesky.js";

let server: Server;
let baseUrl: string;
let authCalls: number;
let lastAuthHeader: string | null;

const SESSION = { accessJwt: "jwt-1", refreshJwt: "refresh-1", did: "did:plc:x", handle: "me.bsky.social" };
const FEED = {
  feed: [{ post: { uri: "at://did:plc:x/app.bsky.feed.post/abc", author: { handle: "bob.bsky.social" }, record: { text: "hello", createdAt: "2026-07-01T10:00:00Z" } } }],
  cursor: null,
};

async function start(opts: { failFirstSession?: boolean } = {}) {
  authCalls = 0;
  server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    if (u.pathname === "/xrpc/com.atproto.server.createSession") {
      authCalls++;
      if (opts.failFirstSession && authCalls === 1) { res.writeHead(401).end(JSON.stringify({ error: "Unauthorized" })); return; }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(SESSION));
      return;
    }
    if (u.pathname.startsWith("/xrpc/app.bsky.")) {
      lastAuthHeader = req.headers.authorization ?? null;
      if (lastAuthHeader !== "Bearer jwt-1") { res.writeHead(401).end(JSON.stringify({ error: "ExpiredToken" })); return; }
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
    const cfg = { search: "open source", identifier: "me.bsky.social", appPassword: "pw", _baseUrl: baseUrl, _authBase: baseUrl };
    const result = await blueskyAdapter.fetch(cfg, null);
    expect(authCalls).toBe(1);
    expect(lastAuthHeader).toBe("Bearer jwt-1");
    expect(result.items).toHaveLength(1);
  });

  it("caches the session across fetches", async () => {
    await start();
    const cfg = { search: "x", identifier: "me.bsky.social", appPassword: "pw", _baseUrl: baseUrl, _authBase: baseUrl, _cacheKey: "cache-test-1" };
    await blueskyAdapter.fetch(cfg, null);
    await blueskyAdapter.fetch(cfg, null);
    expect(authCalls).toBe(1);
  });

  it("re-auths once on 401 from the api", async () => {
    await start();
    // first cached token is stale by construction: use a cache key primed with a bad token via a first fetch against a server that then rotates
    // simpler: fetch with cache key A (session jwt-1 cached), then the api 401s if token != jwt-1 only — so simulate expiry by making session endpoint return jwt-2 on second call
    // (implemented by test server variant below)
    expect(true).toBe(true);
  });

  it("throws on bad credentials", async () => {
    await start({ failFirstSession: true });
    const cfg = { search: "x", identifier: "me.bsky.social", appPassword: "wrong", _baseUrl: baseUrl, _authBase: baseUrl, _cacheKey: "bad-creds" };
    await expect(blueskyAdapter.fetch(cfg, null)).rejects.toThrow(/bluesky auth failed/i);
  });
});
```

(Note for implementer: test 3 as sketched is unusable — replace it with a real re-auth test: make the fixture's session endpoint return `jwt-N` incrementing per call, and the API accept only the LATEST token (401 otherwise). First fetch: session 1 → jwt-1 cached → API ok. Then expire: fetch again with same cache key → API 401s (jwt-1 no longer latest after you force a rotation... simplest deterministic version: session endpoint returns jwt-1 then jwt-2; API accepts only jwt-2. First fetch: auth → jwt-1 → API 401 → adapter re-auths → jwt-2 → API 200. Assert authCalls === 2 and items returned. Write the fixture that way.)

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement in bluesky.ts**

Add to bluesky.ts (keep all existing anonymous behavior):
```ts
interface SessionCacheEntry { token: string; expiresAt: number }
const sessionCache = new Map<string, SessionCacheEntry>();

function credentials(config: Record<string, unknown>): { identifier: string; appPassword: string } | null {
  const identifier = (config.identifier as string) ?? process.env.BLUESKY_IDENTIFIER;
  const appPassword = (config.appPassword as string) ?? process.env.BLUESKY_APP_PASSWORD;
  return identifier && appPassword ? { identifier, appPassword } : null;
}

async function getSession(config: Record<string, unknown>, authBase: string, cacheKey: string, force: boolean): Promise<string> {
  const creds = credentials(config)!;
  const hit = sessionCache.get(cacheKey);
  if (!force && hit && hit.expiresAt > Date.now() + 60_000) return hit.token;
  const res = await fetch(`${authBase}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: creds.identifier, password: creds.appPassword }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`bluesky auth failed: HTTP ${res.status}`);
  const data = (await res.json()) as { accessJwt: string };
  sessionCache.set(cacheKey, { token: data.accessJwt, expiresAt: Date.now() + 100 * 60_000 });
  return data.accessJwt;
}
```
In `fetch`: if credentials present → `const cacheKey = (config._cacheKey as string) ?? creds.identifier`; get session (authBase = config._authBase ?? "https://bsky.social"), call the API at (config._baseUrl ?? "https://bsky.social") with `authorization: Bearer <token>` header (fetchCapped headers param). On a 401 response: retry once with `force: true` re-auth; if still 401 → throw `bluesky fetch failed: HTTP 401`. Anonymous path unchanged (public.api.bsky.app, no auth header). Note: fetchCapped doesn't throw on 401 — check `res.status` after the call and branch.

- [ ] **Step 4: Run tests** — 4 new green (with test 3 rewritten per note), suite green, build green.

- [ ] **Step 5: Commit** — `feat(server): bluesky authenticated sessions with cache and re-auth`

---

### Task 2: Reddit OAuth

**Files:**
- Modify: `packages/server/src/ingestors/reddit.ts`
- Create: `packages/server/test/reddit-auth.test.ts`

- [ ] **Step 1: Failing tests**

`packages/server/test/reddit-auth.test.ts`:
```ts
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
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement in reddit.ts**

```ts
interface TokenEntry { token: string; expiresAt: number }
const tokenCache = new Map<string, TokenEntry>();

function redditCreds(config: Record<string, unknown>): { clientId: string; clientSecret: string; username?: string; password?: string } | null {
  const clientId = (config.clientId as string) ?? process.env.REDDIT_CLIENT_ID;
  const clientSecret = (config.clientSecret as string) ?? process.env.REDDIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const username = (config.username as string) ?? process.env.REDDIT_USERNAME;
  const password = (config.password as string) ?? process.env.REDDIT_PASSWORD;
  return { clientId, clientSecret, ...(username && password ? { username, password } : {}) };
}

async function getToken(config: Record<string, unknown>, tokenBase: string, cacheKey: string): Promise<string> {
  const creds = redditCreds(config)!;
  const hit = tokenCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;
  const body = new URLSearchParams(
    creds.username
      ? { grant_type: "password", username: creds.username, password: creds.password! }
      : { grant_type: "client_credentials" },
  );
  const res = await fetch(`${tokenBase}/api/v1/access_token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64")}`,
      "user-agent": "reader/0.1 (feed reader)",
    },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`reddit auth failed: HTTP ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache.set(cacheKey, { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 120) * 1000 });
  return data.access_token;
}
```
In `fetch`: if redditCreds present → token via cacheKey `(config._cacheKey as string) ?? creds.clientId`, listing URL base becomes `(config._oauthBase as string) ?? "https://oauth.reddit.com"` with `authorization: Bearer <token>` header. Anonymous path unchanged (www.reddit.com, current UA).

- [ ] **Step 4: Run tests** — 3 new green, suite green, build green.

- [ ] **Step 5: Commit** — `feat(server): reddit oauth with token cache`

---

### Task 3: UI credential fields

**Files:**
- Modify: `apps/web/src/IngestorDialog.tsx`
- Modify: `apps/web/src/styles.css` (if needed for password inputs — reuse existing input styles)

- [ ] **Step 1: Dialog changes**

Add an optional "Authentication (optional)" section per platform:
- bluesky: `identifier` (text, placeholder "you.bsky.social"), `appPassword` (password input, placeholder "app password")
- reddit: `clientId` (text), `clientSecret` (password), `username` (text, optional), `password` (password, optional)
- Hint text under the section (class .auth-hint): "Leave blank to try unauthenticated access. Credentials are stored in your local reader database."
- buildConfig includes credential fields only when non-empty.
- styles: `.dialog .auth-hint { font-size: var(--fs-xs); color: var(--text-dim); margin-top: 2px; }`

- [ ] **Step 2: Verify** — web tests + typecheck green, build green.

- [ ] **Step 3: Commit** — `feat(web): credential fields for authenticated ingestors`

---

### Task 4: closeout + live verification

- [ ] Full suite + build green.
- [ ] Update AGENTS.md env-file docs: new optional vars (BLUESKY_IDENTIFIER, BLUESKY_APP_PASSWORD, REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD).
- [ ] Rebuild + restart service. Controller asks user for credentials entry (env file or dialog) and verifies live via agnt.
