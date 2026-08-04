import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type IngestorTestResult } from "./api";
import { ErrorCallout } from "./ErrorCallout";

type Platform = "mastodon" | "bluesky" | "reddit";

interface FormState {
  platform: Platform;
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
  platform: "mastodon",
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

function buildConfig(f: FormState): Record<string, unknown> {
  if (f.platform === "mastodon") return { instance: f.instance.trim(), ...(f.tag.trim() ? { tag: f.tag.trim() } : {}) };
  if (f.platform === "bluesky") {
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

export function IngestorDialog(props: { onClose: () => void }) {
  const [form, setForm] = useState<FormState>(initial);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<IngestorTestResult | null>(null);
  const qc = useQueryClient();
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setTestResult(null);
  };

  const subscribe = useMutation({
    mutationFn: api.createIngestor,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feeds"] });
      qc.invalidateQueries({ queryKey: ["ingestors"] });
      qc.invalidateQueries({ queryKey: ["articles"] });
      props.onClose();
    },
    onError: (e) => setErrorCode(e instanceof ApiError ? e.code : "unknown"),
  });
  const test = useMutation({
    mutationFn: api.testIngestor,
    onSuccess: (result) => { setErrorCode(null); setTestResult(result); },
    onError: (e) => { setTestResult(null); setErrorCode(e instanceof ApiError ? e.code : "unknown"); },
  });

  const config = buildConfig(form);
  const busy = subscribe.isPending || test.isPending;

  return (
    <div className="overlay" onClick={props.onClose}>
      <div className="picker dialog" role="dialog" aria-label="Add ingestor" onClick={(e) => e.stopPropagation()}>
        <h2>Add ingestor</h2>
        <p className="sub">Follow a Mastodon tag, a Bluesky account or search, or a subreddit — at your pace.</p>

        <label htmlFor="ing-platform">Platform</label>
        <select id="ing-platform" value={form.platform} onChange={(e) => set("platform", e.target.value as Platform)}>
          <option value="mastodon">Mastodon</option>
          <option value="bluesky">Bluesky</option>
          <option value="reddit">Reddit</option>
        </select>

        {form.platform === "mastodon" && (
          <div className="row">
            <div>
              <label htmlFor="ing-instance">Instance</label>
              <input id="ing-instance" type="text" value={form.instance} placeholder="mastodon.social" onChange={(e) => set("instance", e.target.value)} />
            </div>
            <div>
              <label htmlFor="ing-tag">Tag</label>
              <input id="ing-tag" type="text" value={form.tag} placeholder="without #" onChange={(e) => set("tag", e.target.value)} />
            </div>
          </div>
        )}
        {form.platform === "bluesky" && (
          <div className="row">
            <div>
              <label htmlFor="ing-handle">Handle</label>
              <input id="ing-handle" type="text" value={form.handle} placeholder="alice.bsky.social" onChange={(e) => set("handle", e.target.value)} />
            </div>
            <div>
              <label htmlFor="ing-search">or Search</label>
              <input id="ing-search" type="text" value={form.search} placeholder="search terms" onChange={(e) => set("search", e.target.value)} />
            </div>
          </div>
        )}
        {form.platform === "reddit" && (
          <div className="row">
            <div>
              <label htmlFor="ing-subreddit">Subreddit</label>
              <input id="ing-subreddit" type="text" value={form.subreddit} placeholder="technology" onChange={(e) => set("subreddit", e.target.value)} />
            </div>
            <div>
              <label htmlFor="ing-sort">Sort</label>
              <select id="ing-sort" value={form.sort} onChange={(e) => set("sort", e.target.value as FormState["sort"])}>
                <option value="new">new</option>
                <option value="hot">hot</option>
                <option value="top">top</option>
              </select>
            </div>
          </div>
        )}

        {form.platform !== "mastodon" && (
          <>
            <label>Authentication (optional)</label>
            {form.platform === "bluesky" && (
              <div className="row">
                <div>
                  <label htmlFor="ing-identifier">Identifier</label>
                  <input id="ing-identifier" type="text" value={form.identifier} placeholder="you.bsky.social" onChange={(e) => set("identifier", e.target.value)} />
                </div>
                <div>
                  <label htmlFor="ing-app-password">App password</label>
                  <input id="ing-app-password" type="password" value={form.appPassword} placeholder="app password" onChange={(e) => set("appPassword", e.target.value)} />
                </div>
              </div>
            )}
            {form.platform === "reddit" && (
              <>
                <div className="row">
                  <div>
                    <label htmlFor="ing-client-id">Client ID</label>
                    <input id="ing-client-id" type="text" value={form.clientId} onChange={(e) => set("clientId", e.target.value)} />
                  </div>
                  <div>
                    <label htmlFor="ing-client-secret">Client secret</label>
                    <input id="ing-client-secret" type="password" value={form.clientSecret} onChange={(e) => set("clientSecret", e.target.value)} />
                  </div>
                </div>
                <div className="row">
                  <div>
                    <label htmlFor="ing-username">Username (optional)</label>
                    <input id="ing-username" type="text" value={form.username} onChange={(e) => set("username", e.target.value)} />
                  </div>
                  <div>
                    <label htmlFor="ing-password">Password (optional)</label>
                    <input id="ing-password" type="password" value={form.password} onChange={(e) => set("password", e.target.value)} />
                  </div>
                </div>
              </>
            )}
            <p className="auth-hint">Leave blank to try unauthenticated access. Credentials are stored in your local reader database.</p>
          </>
        )}

        <div className="row">
          <div>
            <label htmlFor="ing-interval">Fetch every (minutes)</label>
            <input id="ing-interval" type="number" min={5} max={1440} value={form.fetchIntervalMin}
              onChange={(e) => set("fetchIntervalMin", Math.max(5, Math.min(1440, Number(e.target.value) || 60)))} />
          </div>
          <div>
            <label htmlFor="ing-delivery">Delivery</label>
            <select id="ing-delivery" value={form.digestMode} onChange={(e) => set("digestMode", e.target.value as FormState["digestMode"])}>
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
        <label htmlFor="ing-threshold">Keep items scoring at least {form.threshold}/10</label>
        <input id="ing-threshold" type="range" min={0} max={10} value={form.threshold} disabled={!form.llmEnabled}
          onChange={(e) => set("threshold", Number(e.target.value))} />

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
          <button disabled={busy} onClick={() => test.mutate({ kind: form.platform, config, threshold: form.threshold, llmEnabled: form.llmEnabled })}>
            {test.isPending ? "Testing…" : "Test"}
          </button>
          <button className="primary" disabled={busy} onClick={() => subscribe.mutate({
            kind: form.platform, config, fetchIntervalMin: form.fetchIntervalMin,
            digestMode: form.digestMode, filterThreshold: form.threshold, llmEnabled: form.llmEnabled,
          })}>
            {subscribe.isPending ? "Subscribing…" : "Subscribe"}
          </button>
          <button onClick={props.onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
