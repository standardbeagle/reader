import { fetchCapped } from "../fetch.js";
import type { Credential, CredentialSecret, Storage } from "../storage/types.js";

type OAuthSecret = Extract<CredentialSecret, { kind: "oauth2" }>;

/** Refresh this long before expiry so a token does not lapse mid-request. */
const REFRESH_MARGIN_MS = 60_000;

export class CredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialError";
  }
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

/**
 * POST a form to an OAuth token endpoint. Client authentication uses HTTP
 * Basic when there is a secret (RFC 6749 §2.3.1 makes Basic the one method
 * every server must accept) and client_id in the body for public clients.
 */
export async function requestToken(
  tokenUrl: string,
  client: { clientId: string; clientSecret: string | null },
  form: Record<string, string>,
): Promise<TokenResponse> {
  const body = new URLSearchParams(client.clientSecret ? form : { ...form, client_id: client.clientId });
  const res = await fetchCapped(tokenUrl, {
    method: "POST",
    body: body.toString(),
    maxBytes: 64 * 1024,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
      ...(client.clientSecret
        ? { authorization: `Basic ${Buffer.from(`${encodeURIComponent(client.clientId)}:${encodeURIComponent(client.clientSecret)}`).toString("base64")}` }
        : {}),
    },
  });
  if (res.status !== 200) throw new CredentialError(`token endpoint answered HTTP ${res.status}`);
  let data: Partial<TokenResponse>;
  try {
    data = JSON.parse(res.body) as Partial<TokenResponse>;
  } catch {
    throw new CredentialError("token endpoint did not return JSON");
  }
  if (typeof data.access_token !== "string" || !data.access_token) {
    throw new CredentialError("token endpoint returned no access_token");
  }
  return data as TokenResponse;
}

export function expiresAtFrom(token: TokenResponse): string | null {
  return typeof token.expires_in === "number" ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null;
}

// One refresh per credential at a time: providers that rotate refresh tokens
// invalidate the old one, so two concurrent refreshes would strand the loser.
const refreshing = new Map<string, Promise<OAuthSecret>>();

async function refreshOAuth(storage: Storage, credential: Credential, secret: OAuthSecret): Promise<OAuthSecret> {
  const inFlight = refreshing.get(credential.id);
  if (inFlight) return inFlight;
  const run = (async () => {
    if (!secret.refreshToken) {
      throw new CredentialError(`${credential.label}: access token expired and there is no refresh token — reconnect the account`);
    }
    const token = await requestToken(secret.tokenUrl, secret, { grant_type: "refresh_token", refresh_token: secret.refreshToken });
    const next: OAuthSecret = {
      ...secret,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? secret.refreshToken,
      expiresAt: expiresAtFrom(token),
    };
    storage.updateCredentialSecret(credential.id, next);
    return next;
  })();
  refreshing.set(credential.id, run);
  try {
    return await run;
  } finally {
    refreshing.delete(credential.id);
  }
}

/**
 * The Authorization header value for sending `credentialId` to `url`.
 * Refuses a URL outside the credential's origin, and refreshes an OAuth token
 * that is expired or about to be (or unconditionally with `forceRefresh`,
 * after the server rejected the current one).
 */
export async function authorizationFor(
  storage: Storage,
  credentialId: string,
  url: string,
  opts: { forceRefresh?: boolean } = {},
): Promise<string> {
  const credential = storage.getCredential(credentialId);
  if (!credential) throw new CredentialError(`credential ${credentialId} no longer exists`);
  if (new URL(url).origin !== credential.origin) {
    throw new CredentialError(`${credential.label} is for ${credential.origin}, not ${new URL(url).origin}`);
  }
  const secret = credential.secret;
  if (secret.kind === "basic") {
    return `Basic ${Buffer.from(`${secret.username}:${secret.password}`).toString("base64")}`;
  }
  if (secret.kind === "bearer") return `Bearer ${secret.token}`;
  const expiring = secret.expiresAt !== null && Date.parse(secret.expiresAt) - REFRESH_MARGIN_MS <= Date.now();
  const current = opts.forceRefresh || expiring ? await refreshOAuth(storage, credential, secret) : secret;
  return `Bearer ${current.accessToken}`;
}

/** Public view of a credential: never the secret, only what the UI shows. */
export function describeCredential(credential: Credential) {
  return {
    id: credential.id,
    provider: credential.provider,
    kind: credential.secret.kind,
    label: credential.label,
    origin: credential.origin,
    createdAt: credential.createdAt,
  };
}
