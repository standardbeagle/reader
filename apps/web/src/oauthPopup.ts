import { api, ApiError, type Credential, type OAuthStart } from "./api";

type OAuthMessage =
  | { type: "reader-oauth"; ok: true; credential: Omit<Credential, "usedBy"> }
  | { type: "reader-oauth"; ok: false; error: string };

/** The address a provider must redirect back to; Reddit needs it pasted into the app settings. */
export function oauthRedirectUri(): string {
  return `${window.location.origin}/api/v1/oauth/callback`;
}

/**
 * Sign in through the provider in a popup and resolve with the new
 * credential. The popup is opened before any await so the browser counts it
 * as user-initiated; the server's callback page answers on the
 * "reader-oauth" BroadcastChannel. `signal` lets the caller give up (the
 * user closed the popup or pressed Cancel) — popup.closed is unreliable once
 * a provider's opener policy has severed the link.
 */
export async function signInWithPopup(start: OAuthStart, signal: AbortSignal): Promise<Omit<Credential, "usedBy">> {
  const popup = window.open("about:blank", "reader-oauth", "popup,width=560,height=720");
  if (!popup) throw new ApiError("the browser blocked the sign-in window", "popup_blocked", 0);
  const channel = new BroadcastChannel("reader-oauth");
  try {
    const result = new Promise<OAuthMessage>((resolve, reject) => {
      channel.onmessage = (e: MessageEvent<OAuthMessage>) => { if (e.data?.type === "reader-oauth") resolve(e.data); };
      signal.addEventListener("abort", () => reject(new ApiError("sign-in cancelled", "oauth_cancelled", 0)), { once: true });
    });
    const { authorizeUrl } = await api.startOAuth(start);
    popup.location.href = authorizeUrl;
    const message = await result;
    if (!message.ok) throw new ApiError(message.error, "oauth_failed", 0);
    return message.credential;
  } catch (e) {
    popup.close();
    throw e;
  } finally {
    channel.close();
  }
}
