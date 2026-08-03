import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type DiscoveredFeed } from "./api";
import { ErrorCallout } from "./ErrorCallout";
import { FeedPicker } from "./FeedPicker";

export function Sidebar(props: {
  selectedFeedId: string | null;
  onSelectFeed: (id: string | null) => void;
  open: boolean;
  drawer: boolean;
  onCloseDrawer: () => void;
}) {
  const [url, setUrl] = useState("");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState<DiscoveredFeed[] | null>(null);
  const qc = useQueryClient();
  const feeds = useQuery({ queryKey: ["feeds"], queryFn: api.listFeeds });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["feeds"] });
    qc.invalidateQueries({ queryKey: ["articles"] });
  };
  const sub = useMutation({
    mutationFn: api.subscribe,
    onSuccess: (result) => {
      if (result.status === "choices") { setDiscovered(result.feeds); return; }
      setUrl(""); setErrorCode(null); invalidate();
    },
    onError: (e) => setErrorCode(e instanceof ApiError ? e.code : "unknown"),
  });
  const unsub = useMutation({ mutationFn: api.unsubscribe, onSuccess: invalidate });
  const markAll = useMutation({ mutationFn: api.markAllRead, onSuccess: invalidate });

  const total = (feeds.data ?? []).reduce((n, f) => n + f.unreadCount, 0);

  return (
    <>
      <nav className={`sidebar${props.open ? " open" : ""}`}>
        <form onSubmit={(e) => { e.preventDefault(); if (url.trim() && !sub.isPending) sub.mutate(url.trim()); }}>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Add feed URL" aria-label="Feed URL" />
          <button type="submit" disabled={sub.isPending}>Add</button>
        </form>
        {errorCode && <ErrorCallout code={errorCode} onDismiss={() => setErrorCode(null)} />}
        <ul>
          <li className={props.selectedFeedId === null ? "selected" : ""}>
            <button onClick={() => props.onSelectFeed(null)}>
              <span className="feed-title">All items</span>
              <span className="count">{total}</span>
            </button>
          </li>
          {(feeds.data ?? []).map((f) => (
            <li key={f.id} className={props.selectedFeedId === f.id ? "selected" : ""}>
              <button onClick={() => props.onSelectFeed(f.id)}>
                <span className="feed-title">
                  {f.status === "broken" && <span className="warn-badge" title="Feed is failing">⚠ </span>}
                  {f.title}
                </span>
                <span className="count">{f.unreadCount}</span>
              </button>
              <span className="row-actions">
                <button title="Mark all read" onClick={() => markAll.mutate(f.id)}>✓</button>
                <button title="Unsubscribe" onClick={() => { if (confirm(`Unsubscribe from ${f.title}?`)) unsub.mutate(f.id); }}>×</button>
              </span>
            </li>
          ))}
        </ul>
      </nav>
      {props.drawer && props.open && <div className="backdrop" onClick={props.onCloseDrawer} />}
      {discovered && (
        <FeedPicker
          feeds={discovered}
          pending={sub.isPending}
          onPick={(feedUrl) => { setDiscovered(null); sub.mutate(feedUrl); }}
          onCancel={() => setDiscovered(null)}
        />
      )}
    </>
  );
}
