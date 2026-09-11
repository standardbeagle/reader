import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, feedPlatform, type IngestorTestResult, type DiscoveredFeed } from "./api";
import { ErrorCallout } from "./ErrorCallout";
import { FeedPicker } from "./FeedPicker";
import { AccountPicker, useSignIn } from "./Accounts";

type SourceKind = "rss" | "opml" | "youtube" | "composite" | "mastodon" | "bluesky" | "reddit";
type Step = "kind" | "details" | "review";
type FeedAuth = "none" | "basic" | "bearer" | "oauth2";

interface FormState {
  sourceUrl: string;
  feedAuth: FeedAuth;
  authUsername: string;
  authPassword: string;
  authToken: string;
  oauthAuthorizeUrl: string;
  oauthTokenUrl: string;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthScope: string;
  /** Credential from a finished OAuth sign-in for this feed. */
  feedCredentialId: string;
  importText: string;
  importName: string;
  name: string;
  sourceFeedIds: string[];
  instance: string;
  timeline: "tag" | "home";
  tag: string;
  handle: string;
  search: string;
  subreddit: string;
  sort: "new" | "hot" | "top";
  identifier: string;
  appPassword: string;
  /** Connected Mastodon or Reddit account for the source. */
  accountId: string;
  fetchIntervalMin: number;
  digestMode: "realtime" | "hourly" | "daily";
  llmEnabled: boolean;
  threshold: number;
}

const initial: FormState = {
  sourceUrl: "",
  feedAuth: "none",
  authUsername: "",
  authPassword: "",
  authToken: "",
  oauthAuthorizeUrl: "",
  oauthTokenUrl: "",
  oauthClientId: "",
  oauthClientSecret: "",
  oauthScope: "",
  feedCredentialId: "",
  importText: "",
  importName: "",
  name: "",
  sourceFeedIds: [],
  instance: "",
  timeline: "tag",
  tag: "",
  handle: "",
  search: "",
  subreddit: "",
  sort: "new",
  identifier: "",
  appPassword: "",
  accountId: "",
  fetchIntervalMin: 60,
  digestMode: "realtime",
  llmEnabled: true,
  threshold: 5,
};

const KIND_META: { kind: SourceKind; label: string; hint: string }[] = [
  { kind: "rss", label: "RSS / Atom feed", hint: "Follow a site or feed URL directly." },
  { kind: "opml", label: "OPML import", hint: "Move your subscriptions in from another reader." },
  { kind: "youtube", label: "YouTube subscriptions", hint: "Follow every channel from a Google Takeout export." },
  { kind: "composite", label: "Combined AI view", hint: "Merge several RSS feeds into one source, filtered and summarized by AI." },
  { kind: "mastodon", label: "Mastodon", hint: "Follow an account, tag, or search." },
  { kind: "bluesky", label: "Bluesky", hint: "Follow an account or search." },
  { kind: "reddit", label: "Reddit", hint: "Follow a subreddit." },
];

function buildConfig(kind: SourceKind, f: FormState): Record<string, unknown> {
  if (kind === "rss" || kind === "opml" || kind === "youtube") return {};
  if (kind === "composite") return { name: f.name.trim(), sourceFeedIds: f.sourceFeedIds };
  const account = f.accountId ? { credentialId: f.accountId } : {};
  if (kind === "mastodon") {
    return {
      instance: f.instance.trim(),
      ...(f.timeline === "home" ? { timeline: "home" } : { tag: f.tag.trim() }),
      ...account,
    };
  }
  if (kind === "bluesky") {
    return {
      ...(f.handle.trim() ? { handle: f.handle.trim() } : { search: f.search.trim() }),
      ...(f.identifier.trim() ? { identifier: f.identifier.trim() } : {}),
      ...(f.appPassword ? { appPassword: f.appPassword } : {}),
    };
  }
  return { subreddit: f.subreddit.trim(), sort: f.sort, ...account };
}

function feedAuthComplete(f: FormState): boolean {
  if (f.feedAuth === "basic") return f.authUsername.trim().length > 0 && f.authPassword.length > 0;
  if (f.feedAuth === "bearer") return f.authToken.trim().length > 0;
  if (f.feedAuth === "oauth2") return f.feedCredentialId.length > 0;
  return true;
}

function detailsComplete(kind: SourceKind, f: FormState): boolean {
  if (kind === "rss") return /^https?:\/\/.+/.test(f.sourceUrl.trim()) && feedAuthComplete(f);
  if (kind === "opml" || kind === "youtube") return f.importText.length > 0;
  if (kind === "composite") return f.sourceFeedIds.length > 0;
  if (kind === "mastodon") {
    return f.instance.trim().length > 0 && (f.timeline === "home" ? f.accountId.length > 0 : f.tag.trim().length > 0);
  }
  if (kind === "bluesky") return f.handle.trim().length > 0 || f.search.trim().length > 0;
  return f.subreddit.trim().length > 0;
}

function detailsValid(kind: SourceKind, f: FormState): string | null {
  if (kind === "composite" && f.sourceFeedIds.length === 0) return "Pick at least one feed to combine.";
  return null;
}

export function SourceWizard(props: { onClose: () => void }) {
  const [kind, setKind] = useState<SourceKind | null>(null);
  const [step, setStep] = useState<Step>("kind");
  const [form, setForm] = useState<FormState>(initial);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<IngestorTestResult | null>(null);
  const [discovered, setDiscovered] = useState<DiscoveredFeed[] | null>(null);
  const qc = useQueryClient();

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setTestResult(null);
  };

  const feeds = useQuery({ queryKey: ["feeds"], queryFn: api.listFeeds, enabled: kind === "composite" });
  const rssFeeds = (feeds.data ?? []).filter((f) => feedPlatform(f.url) === null);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["feeds"] });
    qc.invalidateQueries({ queryKey: ["ingestors"] });
    qc.invalidateQueries({ queryKey: ["articles"] });
  };

  // A basic/bearer credential is created just before subscribing and removed
  // again if the subscribe fails, so a typo does not leave orphaned secrets.
  const subscribeFeed = async (url: string) => {
    let created: string | null = null;
    if (form.feedAuth === "basic") {
      created = (await api.createCredential({ kind: "basic", url, username: form.authUsername.trim(), password: form.authPassword })).id;
    } else if (form.feedAuth === "bearer") {
      created = (await api.createCredential({ kind: "bearer", url, token: form.authToken.trim() })).id;
    }
    const credentialId = created ?? (form.feedAuth === "oauth2" ? form.feedCredentialId : undefined);
    try {
      return await api.subscribe(url, credentialId);
    } catch (e) {
      if (created) await api.deleteCredential(created).catch(() => {});
      throw e;
    }
  };
  const feedSignIn = useSignIn((c) => set("feedCredentialId", c.id));

  const subscribe = useMutation({
    mutationFn: subscribeFeed,
    onSuccess: (result) => {
      setErrorCode(null);
      if (result.status === "choices") { setDiscovered(result.feeds); return; }
      invalidateAll();
      qc.invalidateQueries({ queryKey: ["credentials"] });
      props.onClose();
    },
    onError: (e) => setErrorCode(e instanceof ApiError ? e.code : "unknown"),
  });
  const createIngestor = useMutation({
    mutationFn: api.createIngestor,
    onSuccess: () => { invalidateAll(); props.onClose(); },
    onError: (e) => setErrorCode(e instanceof ApiError ? e.code : "unknown"),
  });
  const test = useMutation({
    mutationFn: api.testIngestor,
    onSuccess: (result) => { setErrorCode(null); setTestResult(result); },
    onError: (e) => { setTestResult(null); setErrorCode(e instanceof ApiError ? e.code : "unknown"); },
  });
  const importFile = useMutation({
    mutationFn: (text: string) => kind === "youtube" ? api.importYoutubeTakeout(text) : api.importOpml(text),
    onSuccess: () => { invalidateAll(); props.onClose(); },
    onError: (e) => setErrorCode(e instanceof ApiError ? e.code : "unknown"),
  });

  const pickImportFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      set("importText", String(reader.result ?? ""));
      set("importName", file.name);
    };
    reader.readAsText(file);
  };

  const isRss = kind === "rss";
  const isImport = kind === "opml" || kind === "youtube";
  // rss and file imports go straight from details to done; ingestor kinds review first.
  const isIngestor = kind !== null && !isRss && !isImport;
  const config = kind ? buildConfig(kind, form) : {};
  const busy = subscribe.isPending || createIngestor.isPending || test.isPending || importFile.isPending;
  const stepIndex = step === "kind" ? 0 : step === "details" ? 1 : 2;
  const stepLabel = isRss ? ["Type", "Feed URL"] : isImport ? ["Type", "File"] : ["Type", "Source", "Options"];

  const goNext = () => {
    if (!kind) return;
    const problem = detailsValid(kind, form);
    if (problem) { setFormError(problem); return; }
    setFormError(null);
    setStep(isRss ? "details" : "review");
  };

  const pickKind = (k: SourceKind) => {
    setKind(k);
    set("accountId", "");
    setStep("details");
  };

  const back = () => {
    setErrorCode(null);
    setFormError(null);
    if (step === "review") setStep("details");
    else { setStep("kind"); setKind(null); }
  };

  return (
    <div className="overlay" onClick={props.onClose}>
      <div className="picker dialog wizard" role="dialog" aria-label="Add source" onClick={(e) => e.stopPropagation()}>
        <h2>Add source</h2>
        <ol className="wizard-steps" aria-label="Wizard progress">
          {stepLabel.map((label, i) => (
            <li key={label} className={i === stepIndex ? "current" : i < stepIndex ? "done" : ""}>{label}</li>
          ))}
        </ol>

        {step === "kind" && (
          <ul className="source-kinds">
            {KIND_META.map((m) => (
              <li key={m.kind}>
                <button type="button" className="source-kind" onClick={() => pickKind(m.kind)}>
                  <span className="t">{m.label}</span>
                  <span className="u">{m.hint}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {step === "details" && kind === "rss" && (
          <>
            <p className="sub">Paste a website or RSS/Atom feed URL. Reader will discover the best feed to subscribe to.</p>
            <label htmlFor="wiz-url">Feed URL</label>
            <input id="wiz-url" type="url" inputMode="url" value={form.sourceUrl} placeholder="https://example.com/feed.xml"
              autoComplete="url" spellCheck={false}
              onChange={(e) => set("sourceUrl", e.target.value)} />
            <label htmlFor="wiz-feed-auth">Sign-in</label>
            <select id="wiz-feed-auth" value={form.feedAuth} onChange={(e) => set("feedAuth", e.target.value as FeedAuth)}>
              <option value="none">None — public feed</option>
              <option value="basic">Username and password</option>
              <option value="bearer">Access token</option>
              <option value="oauth2">OAuth 2.0 sign-in</option>
            </select>
            {form.feedAuth !== "none" && (
              <p className="auth-hint">With a sign-in, paste the feed's own address — Reader only sends it to that host and skips feed discovery.</p>
            )}
            {form.feedAuth === "basic" && (
              <div className="row">
                <div>
                  <label htmlFor="wiz-auth-user">Username</label>
                  <input id="wiz-auth-user" type="text" autoComplete="off" value={form.authUsername} onChange={(e) => set("authUsername", e.target.value)} />
                </div>
                <div>
                  <label htmlFor="wiz-auth-pass">Password</label>
                  <input id="wiz-auth-pass" type="password" autoComplete="new-password" value={form.authPassword} onChange={(e) => set("authPassword", e.target.value)} />
                </div>
              </div>
            )}
            {form.feedAuth === "bearer" && (
              <>
                <label htmlFor="wiz-auth-token">Token</label>
                <input id="wiz-auth-token" type="password" autoComplete="off" value={form.authToken} onChange={(e) => set("authToken", e.target.value)} />
              </>
            )}
            {form.feedAuth === "oauth2" && (
              <>
                <div className="row">
                  <div>
                    <label htmlFor="wiz-oauth-authorize">Authorize URL</label>
                    <input id="wiz-oauth-authorize" type="url" value={form.oauthAuthorizeUrl} onChange={(e) => set("oauthAuthorizeUrl", e.target.value)} />
                  </div>
                  <div>
                    <label htmlFor="wiz-oauth-token">Token URL</label>
                    <input id="wiz-oauth-token" type="url" value={form.oauthTokenUrl} onChange={(e) => set("oauthTokenUrl", e.target.value)} />
                  </div>
                </div>
                <div className="row">
                  <div>
                    <label htmlFor="wiz-oauth-client">Client ID</label>
                    <input id="wiz-oauth-client" type="text" value={form.oauthClientId} onChange={(e) => set("oauthClientId", e.target.value)} />
                  </div>
                  <div>
                    <label htmlFor="wiz-oauth-secret">Client secret (optional)</label>
                    <input id="wiz-oauth-secret" type="password" value={form.oauthClientSecret} onChange={(e) => set("oauthClientSecret", e.target.value)} />
                  </div>
                </div>
                <label htmlFor="wiz-oauth-scope">Scope (optional)</label>
                <input id="wiz-oauth-scope" type="text" value={form.oauthScope} onChange={(e) => set("oauthScope", e.target.value)} />
                <div className="actions">
                  <button type="button"
                    disabled={feedSignIn.pending || !form.sourceUrl.trim() || !form.oauthAuthorizeUrl.trim() || !form.oauthTokenUrl.trim() || !form.oauthClientId.trim()}
                    onClick={() => feedSignIn.run({
                      provider: "generic",
                      feedUrl: form.sourceUrl.trim(),
                      authorizeUrl: form.oauthAuthorizeUrl.trim(),
                      tokenUrl: form.oauthTokenUrl.trim(),
                      clientId: form.oauthClientId.trim(),
                      ...(form.oauthClientSecret.trim() ? { clientSecret: form.oauthClientSecret.trim() } : {}),
                      ...(form.oauthScope.trim() ? { scope: form.oauthScope.trim() } : {}),
                    })}>
                    {feedSignIn.pending ? "Waiting for sign-in…" : form.feedCredentialId ? "Signed in ✓ — sign in again" : "Sign in"}
                  </button>
                  {feedSignIn.pending && <button type="button" onClick={feedSignIn.cancel}>Cancel</button>}
                </div>
                {feedSignIn.errorCode && <ErrorCallout code={feedSignIn.errorCode} onDismiss={feedSignIn.clearError} />}
              </>
            )}
          </>
        )}

        {step === "details" && kind === "opml" && (
          <>
            <p className="sub">Pick an OPML file exported from another reader. Every feed in it is imported in one go; feeds you already follow are skipped.</p>
            <input
              type="file"
              accept=".opml,.xml,text/xml,text/x-opml"
              aria-label="OPML file"
              onChange={(e) => pickImportFile(e.target.files?.[0])}
            />
            {form.importText && (
              <p className="auth-hint">{form.importName} — {(form.importText.match(/xmlUrl/gi) ?? []).length} feeds found</p>
            )}
          </>
        )}

        {step === "details" && kind === "youtube" && (
          <>
            <p className="sub">YouTube has no feed for your subscriptions, so Reader follows each channel's own feed. Export them from Google Takeout: pick “YouTube and YouTube Music”, keep only “subscriptions”, then choose the <code>subscriptions.csv</code> inside the download.</p>
            <input
              type="file"
              accept=".csv,text/csv"
              aria-label="subscriptions.csv"
              onChange={(e) => pickImportFile(e.target.files?.[0])}
            />
            {form.importText && (
              <p className="auth-hint">{form.importName} — {(form.importText.match(/^\uFEFF?UC[A-Za-z0-9_-]{22},/gm) ?? []).length} channels found</p>
            )}
          </>
        )}

        {step === "details" && kind === "composite" && (
          <>
            <p className="sub">New articles from the selected feeds are scored by AI and kept as one summarized stream.</p>
            <label htmlFor="wiz-name">View name</label>
            <input id="wiz-name" type="text" value={form.name} placeholder="e.g. Tech brief"
              onChange={(e) => set("name", e.target.value)} />
            <label>Combine these feeds ({rssFeeds.length} available)</label>
            {rssFeeds.length === 0 && <p className="auth-hint">No RSS feeds yet. Add at least one feed first.</p>}
            <ul className="wizard-feed-list">
              {rssFeeds.map((f) => (
                <li key={f.id}>
                  <label>
                    <input type="checkbox" checked={form.sourceFeedIds.includes(f.id)}
                      onChange={(e) => set("sourceFeedIds",
                        e.target.checked ? [...form.sourceFeedIds, f.id] : form.sourceFeedIds.filter((id) => id !== f.id))} />
                    {" "}{f.title}
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}

        {step === "details" && kind === "mastodon" && (
          <>
            <div className="row">
              <div>
                <label htmlFor="wiz-instance">Instance</label>
                <input id="wiz-instance" type="text" value={form.instance} placeholder="mastodon.social"
                  onChange={(e) => { set("instance", e.target.value); set("accountId", ""); }} />
              </div>
              <div>
                <label htmlFor="wiz-timeline">Timeline</label>
                <select id="wiz-timeline" value={form.timeline} onChange={(e) => set("timeline", e.target.value as FormState["timeline"])}>
                  <option value="tag">Hashtag</option>
                  <option value="home">My home timeline</option>
                </select>
              </div>
            </div>
            {form.timeline === "tag" && (
              <>
                <label htmlFor="wiz-tag">Tag</label>
                <input id="wiz-tag" type="text" value={form.tag} placeholder="without #" onChange={(e) => set("tag", e.target.value)} />
              </>
            )}
            <AccountPicker provider="mastodon" instance={form.instance} value={form.accountId} onChange={(id) => set("accountId", id)} />
            <p className="auth-hint">{form.timeline === "home" ? "The home timeline needs a connected account." : "Optional for hashtags; some instances only show them to signed-in users."}</p>
          </>
        )}
        {step === "details" && kind === "bluesky" && (
          <>
            <div className="row">
              <div>
                <label htmlFor="wiz-handle">Handle</label>
                <input id="wiz-handle" type="text" value={form.handle} placeholder="alice.bsky.social" onChange={(e) => set("handle", e.target.value)} />
              </div>
              <div>
                <label htmlFor="wiz-search">or Search</label>
                <input id="wiz-search" type="text" value={form.search} placeholder="search terms" onChange={(e) => set("search", e.target.value)} />
              </div>
            </div>
            <label>Authentication (optional)</label>
            <div className="row">
              <div>
                <label htmlFor="wiz-identifier">Identifier</label>
                <input id="wiz-identifier" type="text" value={form.identifier} placeholder="you.bsky.social" onChange={(e) => set("identifier", e.target.value)} />
              </div>
              <div>
                <label htmlFor="wiz-app-password">App password</label>
                <input id="wiz-app-password" type="password" value={form.appPassword} placeholder="app password" onChange={(e) => set("appPassword", e.target.value)} />
              </div>
            </div>
            <p className="auth-hint">Leave blank to try unauthenticated access. Credentials are stored in your local reader database.</p>
          </>
        )}
        {step === "details" && kind === "reddit" && (
          <>
            <div className="row">
              <div>
                <label htmlFor="wiz-subreddit">Subreddit</label>
                <input id="wiz-subreddit" type="text" value={form.subreddit} placeholder="technology" onChange={(e) => set("subreddit", e.target.value)} />
              </div>
              <div>
                <label htmlFor="wiz-sort">Sort</label>
                <select id="wiz-sort" value={form.sort} onChange={(e) => set("sort", e.target.value as FormState["sort"])}>
                  <option value="new">new</option>
                  <option value="hot">hot</option>
                  <option value="top">top</option>
                </select>
              </div>
            </div>
            <AccountPicker provider="reddit" value={form.accountId} onChange={(id) => set("accountId", id)} />
            <p className="auth-hint">Without an account Reader reads Reddit's public pages, which Reddit often rate-limits or blocks.</p>
          </>
        )}

        {step === "review" && kind && (
          <>
            <div className="row">
              <div>
                <label htmlFor="wiz-interval">Fetch every (minutes)</label>
                <input id="wiz-interval" type="number" min={5} max={1440} value={form.fetchIntervalMin}
                  onChange={(e) => set("fetchIntervalMin", Math.max(5, Math.min(1440, Number(e.target.value) || 60)))} />
              </div>
              <div>
                <label htmlFor="wiz-delivery">Delivery</label>
                <select id="wiz-delivery" value={form.digestMode} onChange={(e) => set("digestMode", e.target.value as FormState["digestMode"])}>
                  <option value="realtime">realtime</option>
                  <option value="hourly">hourly digest</option>
                  <option value="daily">daily digest</option>
                </select>
              </div>
            </div>
            <label>
              <input type="checkbox" checked={form.llmEnabled} onChange={(e) => set("llmEnabled", e.target.checked)} />
              {" "}LLM filtering &amp; summaries
            </label>
            <label htmlFor="wiz-threshold">Keep items scoring at least {form.threshold}/10</label>
            <input id="wiz-threshold" type="range" min={0} max={10} value={form.threshold} disabled={!form.llmEnabled}
              onChange={(e) => set("threshold", Number(e.target.value))} />
          </>
        )}

        {formError && <p className="auth-hint" role="alert">{formError}</p>}
        {errorCode && <ErrorCallout code={errorCode} onDismiss={() => setErrorCode(null)} />}

        {testResult && (
          <div className="test-results">
            <h4>Kept ({testResult.kept.length})</h4>
            <ul>
              {testResult.kept.slice(0, 5).map((k, i) => (
                <li key={i}>
                  <span className="score">{k.score ?? "–"}</span> {k.title}
                  <div className="reason">{k.summary}</div>
                </li>
              ))}
            </ul>
            <h4>Dropped ({testResult.dropped.length})</h4>
            <ul>
              {testResult.dropped.slice(0, 5).map((d, i) => (
                <li key={i}>
                  <span className="score">{d.score}</span> {d.title}
                  <div className="reason">{d.reason}</div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="actions">
          {step !== "kind" && <button disabled={busy} onClick={back}>Back</button>}
          {step === "details" && isRss && (
            <button className="primary" disabled={busy || !detailsComplete("rss", form)}
              onClick={() => subscribe.mutate(form.sourceUrl.trim())}>
              {subscribe.isPending ? "Adding…" : "Add feed"}
            </button>
          )}
          {step === "details" && isImport && (
            <button className="primary" disabled={busy || !detailsComplete(kind!, form)}
              onClick={() => importFile.mutate(form.importText)}>
              {importFile.isPending ? "Importing…" : kind === "youtube" ? "Import channels" : "Import feeds"}
            </button>
          )}
          {step === "details" && isIngestor && (
            <button className="primary" disabled={busy || !detailsComplete(kind!, form)} onClick={goNext}>Next</button>
          )}
          {step === "review" && kind && (
            <>
              <button disabled={busy}
                onClick={() => test.mutate({ kind, config, threshold: form.threshold, llmEnabled: form.llmEnabled })}>
                {test.isPending ? "Testing…" : "Test"}
              </button>
              <button className="primary" disabled={busy}
                onClick={() => createIngestor.mutate({
                  kind, config, fetchIntervalMin: form.fetchIntervalMin,
                  digestMode: form.digestMode, filterThreshold: form.threshold, llmEnabled: form.llmEnabled,
                })}>
                {createIngestor.isPending ? "Subscribing…" : "Subscribe"}
              </button>
            </>
          )}
          <button onClick={props.onClose}>Cancel</button>
        </div>
      </div>
      {discovered && (
        <FeedPicker
          feeds={discovered}
          pending={subscribe.isPending}
          onPick={(feedUrl) => { setDiscovered(null); subscribe.mutate(feedUrl); }}
          onCancel={() => setDiscovered(null)}
        />
      )}
    </div>
  );
}
