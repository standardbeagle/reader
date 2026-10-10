import { CredentialError } from "../auth/credentials.js";
import type { Credential, CredentialSecret, Ingestor, Storage } from "../storage/types.js";
import { libbyOrigin, renewSignIn, signInWithCode, syncAccount, tokenExpiry } from "./client.js";

/** The one feed address a Libby account's hold notices arrive on. */
export const LIBBY_FEED_URL = "ingestor://libby/holds";
/** Queue positions move slowly; a faster poll only raises the odds of being cut off. */
const SYNC_INTERVAL_MIN = 30;
/** Renew this long before the sign-in lapses (tokens last about a week). */
const RENEW_BEFORE_MS = 3 * 86_400_000;

function secretFor(token: string): CredentialSecret {
  // Libby has no refresh token. An oauth2 secret with none is the existing
  // shape for "works until expiresAt, then the user must sign in again".
  return {
    kind: "oauth2", tokenUrl: `${libbyOrigin()}/chip?client=dewey`, clientId: "libby", clientSecret: null,
    accessToken: token, refreshToken: null, expiresAt: tokenExpiry(token),
  };
}

export function libbyIngestor(storage: Storage, userId: string): Ingestor | null {
  return storage.listIngestors(userId).find((i) => i.kind === "libby") ?? null;
}

export function libbyCredential(storage: Storage, ingestor: Ingestor): Credential | null {
  const credential = typeof ingestor.config.credentialId === "string" ? storage.getCredential(ingestor.config.credentialId) : null;
  return credential?.provider === "libby" ? credential : null;
}

/** When the stored sign-in lapses; null if the token carries no expiry. */
export function libbyExpiresAt(credential: Credential): string | null {
  return credential.secret.kind === "oauth2" ? credential.secret.expiresAt : null;
}

/**
 * Link (or re-link) the user's Libby account from a setup code. A re-link
 * replaces the sign-in on the existing ingestor, so the hold history and the
 * queue snapshot survive a lapsed token.
 */
export async function linkLibby(storage: Storage, userId: string, code: string): Promise<Ingestor> {
  const token = await signInWithCode(code);
  // Sync before storing anything: a code that links to no library cards must not leave a dead account behind.
  const { cards } = await syncAccount(token);
  const label = cards.map((c) => c.library).join(", ");
  const existing = libbyIngestor(storage, userId);
  const current = existing && libbyCredential(storage, existing);
  if (existing && current) {
    storage.updateCredentialSecret(current.id, secretFor(token));
    storage.updateIngestorState(existing.id, { errorCount: 0, status: "ok", lastError: null });
    return storage.getIngestor(existing.id)!;
  }
  if (existing) {
    // Its credential was deleted from Accounts; the ingestor cannot be revived without one.
    storage.deleteIngestor(existing.id);
    storage.deleteFeed(existing.feedId);
  }
  const credential = storage.createCredential(userId, { provider: "libby", label, origin: libbyOrigin(), secret: secretFor(token) });
  const feed = storage.createFeed(userId, { url: LIBBY_FEED_URL, title: "Libby holds", siteUrl: "https://libbyapp.com" });
  const ingestor = storage.createIngestor(userId, { kind: "libby", config: { credentialId: credential.id }, feedId: feed.id });
  // LLM off: hold notices are exact status lines and must not be paraphrased or filtered.
  return storage.updateIngestor(ingestor.id, { llmEnabled: false, digestMode: "realtime", fetchIntervalMin: SYNC_INTERVAL_MIN });
}

export function unlinkLibby(storage: Storage, ingestor: Ingestor): void {
  const credential = libbyCredential(storage, ingestor);
  storage.deleteIngestor(ingestor.id);
  storage.deleteFeed(ingestor.feedId);
  if (credential) storage.deleteCredential(credential.id);
}

/**
 * The sign-in token to send to Libby's sync service, renewed when it is close
 * to lapsing. Refuses to hand the token to any origin but the one it was
 * issued for.
 */
export async function libbyToken(storage: Storage, credentialId: string): Promise<string> {
  const credential = storage.getCredential(credentialId);
  if (!credential || credential.provider !== "libby" || credential.secret.kind !== "oauth2") {
    throw new CredentialError("the Libby sign-in no longer exists — link the account again");
  }
  if (credential.origin !== libbyOrigin()) {
    throw new CredentialError(`the Libby sign-in is for ${credential.origin}, not ${libbyOrigin()}`);
  }
  const { accessToken, expiresAt } = credential.secret;
  if (expiresAt === null) return accessToken;
  const remaining = Date.parse(expiresAt) - Date.now();
  if (remaining <= 0) throw new CredentialError("the Libby sign-in has expired — link the account again with a new setup code");
  if (remaining > RENEW_BEFORE_MS) return accessToken;
  const renewed = await renewSignIn(accessToken);
  storage.updateCredentialSecret(credential.id, secretFor(renewed));
  return renewed;
}
