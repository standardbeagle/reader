import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

export function Sidebar(props: { selectedFeedId: string | null; onSelectFeed: (id: string | null) => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const feeds = useQuery({ queryKey: ["feeds"], queryFn: api.listFeeds });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["feeds"] });
    qc.invalidateQueries({ queryKey: ["articles"] });
  };
  const sub = useMutation({
    mutationFn: api.subscribe,
    onSuccess: () => { setUrl(""); setError(null); invalidate(); },
    onError: (e) => setError(e.message),
  });
  const unsub = useMutation({ mutationFn: api.unsubscribe, onSuccess: invalidate });
  const markAll = useMutation({ mutationFn: api.markAllRead, onSuccess: invalidate });

  const total = (feeds.data ?? []).reduce((n, f) => n + f.unreadCount, 0);

  return (
    <nav className="sidebar">
      <h1>Reader</h1>
      <form onSubmit={(e) => { e.preventDefault(); if (url.trim() && !sub.isPending) sub.mutate(url.trim()); }}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Add feed URL" aria-label="Feed URL" />
        <button type="submit" disabled={sub.isPending}>Add</button>
      </form>
      {error && <p className="error">{error}</p>}
      <ul>
        <li className={props.selectedFeedId === null ? "selected" : ""}>
          <button onClick={() => props.onSelectFeed(null)}>All items ({total})</button>
        </li>
        {(feeds.data ?? []).map((f) => (
          <li key={f.id} className={props.selectedFeedId === f.id ? "selected" : ""}>
            <button onClick={() => props.onSelectFeed(f.id)}>
              {f.status === "broken" && <span title="Feed is failing">⚠ </span>}
              {f.title} ({f.unreadCount})
            </button>
            <button title="Mark all read" onClick={() => markAll.mutate(f.id)}>✓</button>
            <button title="Unsubscribe" onClick={() => { if (confirm(`Unsubscribe from ${f.title}?`)) unsub.mutate(f.id); }}>×</button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
