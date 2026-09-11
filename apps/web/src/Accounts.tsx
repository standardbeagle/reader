import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Credential, type OAuthStart } from "./api";
import { ErrorCallout } from "./ErrorCallout";
import { oauthRedirectUri, signInWithPopup } from "./oauthPopup";

/** Popup sign-in with a cancel handle; the new credential lands in the ["credentials"] cache. */
export function useSignIn(onConnected: (credential: Omit<Credential, "usedBy">) => void) {
  const qc = useQueryClient();
  const abort = useRef<AbortController | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const run = async (start: OAuthStart) => {
    abort.current = new AbortController();
    setPending(true);
    setErrorCode(null);
    try {
      const credential = await signInWithPopup(start, abort.current.signal);
      qc.invalidateQueries({ queryKey: ["credentials"] });
      onConnected(credential);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "unknown";
      if (code !== "oauth_cancelled") setErrorCode(code);
    } finally {
      setPending(false);
    }
  };
  return { run, pending, errorCode, clearError: () => setErrorCode(null), cancel: () => abort.current?.abort() };
}

/**
 * Pick a connected Mastodon or Reddit account for a source, or connect one.
 * Mastodon accounts are matched to the instance, since a token only works there.
 */
export function AccountPicker(props: {
  provider: "mastodon" | "reddit";
  instance?: string;
  value: string;
  onChange: (credentialId: string) => void;
}) {
  const credentials = useQuery({ queryKey: ["credentials"], queryFn: api.listCredentials });
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const signIn = useSignIn((c) => props.onChange(c.id));
  const instance = props.instance?.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "") ?? "";
  const matching = (credentials.data ?? []).filter((c) =>
    c.provider === props.provider && (props.provider !== "mastodon" || c.origin === `https://${instance}`));

  return (
    <>
      <label htmlFor={`account-${props.provider}`}>Account</label>
      <select id={`account-${props.provider}`} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        <option value="">Not signed in</option>
        {matching.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
      {props.provider === "mastodon" && (
        <div className="actions">
          <button type="button" disabled={!instance || signIn.pending}
            onClick={() => signIn.run({ provider: "mastodon", instance })}>
            {signIn.pending ? "Waiting for sign-in…" : `Connect a ${instance || "Mastodon"} account`}
          </button>
          {signIn.pending && <button type="button" onClick={signIn.cancel}>Cancel</button>}
        </div>
      )}
      {props.provider === "reddit" && (
        <details>
          <summary>Connect a Reddit account</summary>
          <p className="auth-hint">
            Create a <strong>web app</strong> at reddit.com/prefs/apps with this redirect URI, then paste its id and secret.
            They are used once to sign in; Reddit never sees your password.
          </p>
          <input type="text" readOnly value={oauthRedirectUri()} aria-label="Redirect URI" onFocus={(e) => e.target.select()} />
          <div className="row">
            <div>
              <label htmlFor="reddit-client-id">Client ID</label>
              <input id="reddit-client-id" type="text" value={clientId} onChange={(e) => setClientId(e.target.value)} />
            </div>
            <div>
              <label htmlFor="reddit-client-secret">Client secret</label>
              <input id="reddit-client-secret" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
            </div>
          </div>
          <div className="actions">
            <button type="button" disabled={!clientId.trim() || !clientSecret.trim() || signIn.pending}
              onClick={() => signIn.run({ provider: "reddit", clientId: clientId.trim(), clientSecret: clientSecret.trim() })}>
              {signIn.pending ? "Waiting for sign-in…" : "Sign in with Reddit"}
            </button>
            {signIn.pending && <button type="button" onClick={signIn.cancel}>Cancel</button>}
          </div>
        </details>
      )}
      {signIn.errorCode && <ErrorCallout code={signIn.errorCode} onDismiss={signIn.clearError} />}
    </>
  );
}

/** Connected accounts: remove them, or attach one to existing sources of its platform. */
export function AccountsDialog(props: { onClose: () => void }) {
  const qc = useQueryClient();
  const credentials = useQuery({ queryKey: ["credentials"], queryFn: api.listCredentials });
  const ingestors = useQuery({ queryKey: ["ingestors"], queryFn: api.listIngestors });
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["credentials"] });
    qc.invalidateQueries({ queryKey: ["ingestors"] });
  };
  const onError = (e: unknown) => setErrorCode(e instanceof ApiError ? e.code : "unknown");
  const remove = useMutation({ mutationFn: api.deleteCredential, onSuccess: refresh, onError });
  const attach = useMutation({
    mutationFn: (input: { ingestorId: string; credentialId: string }) =>
      api.updateIngestor(input.ingestorId, { credentialId: input.credentialId }),
    onSuccess: refresh,
    onError,
  });

  return (
    <div className="overlay" onClick={props.onClose}>
      <div className="picker dialog" role="dialog" aria-label="Connected accounts" onClick={(e) => e.stopPropagation()}>
        <h2>Connected accounts</h2>
        <p className="sub">Sign-ins that feeds and sources use. Connect Mastodon and Reddit accounts from Add source.</p>
        {(credentials.data ?? []).length === 0 && <p className="auth-hint">No connected accounts yet.</p>}
        <ul>
          {(credentials.data ?? []).map((c) => {
            const unsigned = (ingestors.data ?? []).filter((i) => i.kind === c.provider && i.config.credentialId !== c.id
              && (c.provider !== "mastodon" || `https://${String(i.config.instance)}` === c.origin));
            return (
              <li key={c.id}>
                <div className="info">
                  <div className="t">{c.label}</div>
                  <div className="u">{c.provider === "generic" ? `${c.kind} sign-in for ${c.origin}` : c.provider} · used by {c.usedBy}</div>
                  {unsigned.map((i) => (
                    <button key={i.id} type="button" className="sub-btn" disabled={attach.isPending}
                      onClick={() => attach.mutate({ ingestorId: i.id, credentialId: c.id })}>
                      Use for {i.feedTitle ?? i.kind}
                    </button>
                  ))}
                </div>
                <button type="button" disabled={remove.isPending || c.usedBy > 0}
                  title={c.usedBy > 0 ? "Remove the sources that use it first" : "Remove this account"}
                  onClick={() => { if (confirm(`Remove ${c.label}?`)) remove.mutate(c.id); }}>
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
        {errorCode && <ErrorCallout code={errorCode} onDismiss={() => setErrorCode(null)} />}
        <button className="cancel" onClick={props.onClose}>Close</button>
      </div>
    </div>
  );
}
