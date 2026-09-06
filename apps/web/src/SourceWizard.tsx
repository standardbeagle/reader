import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, feedPlatform, type IngestorTestResult, type DiscoveredFeed } from "./api";
import { ErrorCallout } from "./ErrorCallout";
import { FeedPicker } from "./FeedPicker";

type SourceKind = "rss" | "composite" | "mastodon" | "bluesky" | "reddit";
type Step = "kind" | "details" | "review";

interface FormState {
  sourceUrl: string;
  name: string;
  sourceFeedIds: string[];
  instance: string;
  tag: string;
  handle: string;
  search: string;
  subreddit: string;
  sort: "new" | "hot" | "top";
  identifier: string;
  appPassword: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  fetchIntervalMin: number;
  digestMode: "realtime" | "hourly" | "daily";
  llmEnabled: boolean;
  threshold: number;
}

const initial: FormState = {
  sourceUrl: "",
  name: "",
  sourceFeedIds: [],
  instance: "",
  tag: "",
  handle: "",
  search: "",
  subreddit: "",
  sort: "new",
  identifier: "",
  appPassword: "",
  clientId: "",
  clientSecret: "",
  username: "",
  password: "",
  fetchIntervalMin: 60,
  digestMode: "realtime",
  llmEnabled: true,
  threshold: 5,
};

const KIND_META: { kind: SourceKind; label: string; hint: string }[] = [
  { kind: "rss", label: "RSS / Atom feed", hint: "Follow a site or feed URL directly." },
  { kind: "composite", label: "Combined AI view", hint: "Merge several RSS feeds into one source, filtered and summarized by AI." },
  { kind: "mastodon", label: "Mastodon", hint: "Follow an account, tag, or search." },
  { kind: "bluesky", label: "Bluesky", hint: "Follow an account or search." },
  { kind: "reddit", label: "Reddit", hint: "Follow a subreddit." },
];

function buildConfig(kind: SourceKind, f: FormState): Record<string, unknown> {
  if (kind === "rss") return {};
  if (kind === "composite") return { name: f.name.trim(), sourceFeedIds: f.sourceFeedIds };
  if (kind === "mastodon") return { instance: f.instance.trim(), ...(f.tag.trim() ? { tag: f.tag.trim() } : {}) };
  if (kind === "bluesky") {
    return {
      ...(f.handle.trim() ? { handle: f.handle.trim() } : { search: f.search.trim() }),
      ...(f.identifier.trim() ? { identifier: f.identifier.trim() } : {}),
      ...(f.appPassword ? { appPassword: f.appPassword } : {}),
    };
  }
  return {
    subreddit: f.subreddit.trim(),
    sort: f.sort,
    ...(f.clientId.trim() ? { clientId: f.clientId.trim() } : {}),
    ...(f.clientSecret ? { clientSecret: f.clientSecret } : {}),
    ...(f.username.trim() ? { username: f.username.trim() } : {}),
    ...(f.password ? { password: f.password } : {}),
  };
}

function detailsComplete(kind: SourceKind, f: FormState): boolean {
  if (kind === "rss") return /^https?:\/\/.+/.test(f.sourceUrl.trim());
  if (kind === "composite") return f.sourceFeedIds.length > 0;
  if (kind === "mastodon") return f.instance.trim().length > 0;
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

  const subscribe = useMutation({
    mutationFn: api.subscribe,
    onSuccess: (result) => {
      setErrorCode(null);
      if (result.status === "choices") { setDiscovered(result.feeds); return; }
      invalidateAll();
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

  const isRss = kind === "rss";
  const isIngestor = kind !== null && kind !== "rss";
  const config = kind ? buildConfig(kind, form) : {};
  const busy = subscribe.isPending || createIngestor.isPending || test.isPending;
  const stepIndex = step === "kind" ? 0 : step === "details" ? 1 : 2;
  const stepLabel = isRss ? ["Type", "Feed URL"] : ["Type", "Source", "Options"];

  const goNext = () => {
    if (!kind) return;
    const problem = detailsValid(kind, form);
    if (problem) { setFormError(problem); return; }
    setFormError(null);
    setStep(isRss ? "details" : "review");
  };

  const pickKind = (k: SourceKind) => {
    setKind(k);
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
          <div className="row">
            <div>
              <label htmlFor="wiz-instance">Instance</label>
              <input id="wiz-instance" type="text" value={form.instance} placeholder="mastodon.social" onChange={(e) => set("instance", e.target.value)} />
            </div>
            <div>
              <label htmlFor="wiz-tag">Tag</label>
              <input id="wiz-tag" type="text" value={form.tag} placeholder="without #" onChange={(e) => set("tag", e.target.value)} />
            </div>
          </div>
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
            <label>Authentication (optional)</label>
            <div className="row">
              <div>
                <label htmlFor="wiz-client-id">Client ID</label>
                <input id="wiz-client-id" type="text" value={form.clientId} onChange={(e) => set("clientId", e.target.value)} />
              </div>
              <div>
                <label htmlFor="wiz-client-secret">Client secret</label>
                <input id="wiz-client-secret" type="password" value={form.clientSecret} onChange={(e) => set("clientSecret", e.target.value)} />
              </div>
            </div>
            <div className="row">
              <div>
                <label htmlFor="wiz-username">Username</label>
                <input id="wiz-username" type="text" value={form.username} onChange={(e) => set("username", e.target.value)} />
              </div>
              <div>
                <label htmlFor="wiz-password">Password</label>
                <input id="wiz-password" type="password" value={form.password} onChange={(e) => set("password", e.target.value)} />
              </div>
            </div>
            <p className="auth-hint">Leave blank to try unauthenticated access. Credentials are stored in your local reader database.</p>
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
          {step === "details" && !isRss && (
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
