import { createHash, randomBytes } from "node:crypto";
import { fetchCapped } from "../fetch.js";
import type { Credential, CredentialProvider, Storage } from "../storage/types.js";
import { CredentialError, expiresAtFrom, requestToken } from "./credentials.js";

/**
 * OAuth 2.0 authorization-code sign-in. A flow starts on the server, which
 * returns the provider's authorize URL; the browser signs in there and the
 * provider redirects back to /api/v1/oauth/callback, where completeFlow trades
 * the code for tokens and stores a credential. The redirect goes to the user's
 * browser, never server-to-server, so this works on a loopback-only listener.
 */

const FLOW_TTL_MS = 10 * 60_000;
const MAX_PENDING_FLOWS = 50;

interface PendingFlow {
  provider: CredentialProvider;
  userId: string;
  /** Origin the finished credential will be bound to. */
  origin: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string | null;
  redirectUri: string;
  codeVerifier: string | null;
  /** Resolves the account name to label the credential with. */
  label: (accessToken: string) => Promise<string>;
  createdAt: number;
}

const pending = new Map<string, PendingFlow>();

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function beginFlow(flow: Omit<PendingFlow, "createdAt">, authorizeUrl: URL, extra: Record<string, string>): string {
  const now = Date.now();
  for (const [state, f] of pending) if (now - f.createdAt > FLOW_TTL_MS) pending.delete(state);
  if (pending.size >= MAX_PENDING_FLOWS) throw new CredentialError("too many sign-ins in progress; try again in a few minutes");
  const state = randomToken();
  pending.set(state, { ...flow, createdAt: now });
  const params = new URLSearchParams({
    response_type: "code",
    client_id: flow.clientId,
    redirect_uri: flow.redirectUri,
    state,
    ...extra,
  });
  for (const [k, v] of params) authorizeUrl.searchParams.set(k, v);
  return authorizeUrl.href;
}

async function getJson(url: string, accessToken: string): Promise<Record<string, unknown>> {
  const res = await fetchCapped(url, { maxBytes: 256 * 1024, headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" } });
  if (res.status !== 200) throw new CredentialError(`${new URL(url).host} answered HTTP ${res.status}`);
  return JSON.parse(res.body) as Record<string, unknown>;
}

/** Register Reader as an app on the instance, then start its sign-in. */
export async function startMastodonFlow(userId: string, instanceBase: string, redirectUri: string): Promise<string> {
  const base = new URL(instanceBase).origin;
  const res = await fetchCapped(`${base}/api/v1/apps`, {
    method: "POST",
    maxBytes: 64 * 1024,
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ client_name: "Reader", redirect_uris: redirectUri, scopes: "read" }).toString(),
  });
  if (res.status !== 200) throw new CredentialError(`${new URL(base).host} refused app registration: HTTP ${res.status}`);
  const app = JSON.parse(res.body) as { client_id?: string; client_secret?: string };
  if (!app.client_id || !app.client_secret) throw new CredentialError("instance returned no client credentials");
  const host = new URL(base).host;
  return beginFlow({
    provider: "mastodon", userId, origin: base,
    tokenUrl: `${base}/oauth/token`,
    clientId: app.client_id, clientSecret: app.client_secret,
    redirectUri, codeVerifier: null,
    label: async (token) => `@${String((await getJson(`${base}/api/v1/accounts/verify_credentials`, token)).acct)}@${host}`,
  }, new URL(`${base}/oauth/authorize`), { scope: "read" });
}

export interface RedditEndpoints { authorizeUrl: string; tokenUrl: string; apiBase: string }

export const REDDIT_ENDPOINTS: RedditEndpoints = {
  authorizeUrl: "https://www.reddit.com/api/v1/authorize",
  tokenUrl: "https://www.reddit.com/api/v1/access_token",
  apiBase: "https://oauth.reddit.com",
};

/**
 * Reddit has no dynamic registration: the user creates a "web app" at
 * reddit.com/prefs/apps with our callback as its redirect URI and hands over
 * its client id and secret. duration=permanent yields a refresh token.
 */
export function startRedditFlow(
  userId: string, client: { clientId: string; clientSecret: string }, redirectUri: string,
  endpoints: RedditEndpoints = REDDIT_ENDPOINTS,
): string {
  return beginFlow({
    provider: "reddit", userId, origin: new URL(endpoints.apiBase).origin,
    tokenUrl: endpoints.tokenUrl,
    clientId: client.clientId, clientSecret: client.clientSecret,
    redirectUri, codeVerifier: null,
    label: async (token) => `u/${String((await getJson(`${endpoints.apiBase}/api/v1/me`, token)).name)}`,
  }, new URL(endpoints.authorizeUrl), { duration: "permanent", scope: "identity read" });
}

/** Any OAuth 2.0 provider guarding a feed; PKCE (S256) always. */
export function startGenericFlow(
  userId: string,
  input: { feedUrl: string; authorizeUrl: string; tokenUrl: string; clientId: string; clientSecret: string | null; scope: string | null },
  redirectUri: string,
): string {
  const feed = new URL(input.feedUrl);
  const codeVerifier = randomToken();
  const challenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return beginFlow({
    provider: "generic", userId, origin: feed.origin,
    tokenUrl: input.tokenUrl,
    clientId: input.clientId, clientSecret: input.clientSecret,
    redirectUri, codeVerifier,
    label: async () => feed.host,
  }, new URL(input.authorizeUrl), {
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...(input.scope ? { scope: input.scope } : {}),
  });
}

/** Trade the provider's code for tokens and store the credential. Single use per state. */
export async function completeFlow(storage: Storage, state: string, code: string): Promise<Credential> {
  const flow = pending.get(state);
  pending.delete(state);
  if (!flow || Date.now() - flow.createdAt > FLOW_TTL_MS) {
    throw new CredentialError("this sign-in expired or was already used; start again");
  }
  const token = await requestToken(flow.tokenUrl, flow, {
    grant_type: "authorization_code",
    code,
    redirect_uri: flow.redirectUri,
    ...(flow.codeVerifier ? { code_verifier: flow.codeVerifier } : {}),
  });
  const label = await flow.label(token.access_token);
  return storage.createCredential(flow.userId, {
    provider: flow.provider,
    label,
    origin: flow.origin,
    secret: {
      kind: "oauth2",
      tokenUrl: flow.tokenUrl,
      clientId: flow.clientId,
      clientSecret: flow.clientSecret,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      expiresAt: expiresAtFrom(token),
    },
  });
}
