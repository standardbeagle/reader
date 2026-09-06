import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, feedPlatform } from "./api";
import { SourceWizard } from "./SourceWizard";
import { CreateListDialog } from "./ListDialogs";

export function Sidebar(props: {
  selectedFeedId: string | null;
  selectedListId: string | null;
  onSelectFeed: (id: string | null) => void;
  onSelectList: (id: string | null) => void;
  open: boolean;
  drawer: boolean;
  onCloseDrawer: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onRefreshFeed: (id: string) => void;
  refreshingFeedId: string | null;
  onActionError?: (message: string) => void;
}) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [createListOpen, setCreateListOpen] = useState(false);
  const qc = useQueryClient();
  const feeds = useQuery({ queryKey: ["feeds"], queryFn: api.listFeeds, refetchInterval: 60_000 });
  const ingestors = useQuery({ queryKey: ["ingestors"], queryFn: api.listIngestors });
  const lists = useQuery({ queryKey: ["lists"], queryFn: api.listLists });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["feeds"] });
    qc.invalidateQueries({ queryKey: ["articles"] });
  };
  const unsub = useMutation({
    mutationFn: api.unsubscribe,
    onSuccess: invalidate,
    onError: () => props.onActionError?.("Could not unsubscribe from that feed."),
  });
  const markAll = useMutation({
    mutationFn: api.markAllRead,
    onSuccess: invalidate,
    onError: () => props.onActionError?.("Could not mark that feed read."),
  });
  const deleteList = useMutation({
    mutationFn: api.deleteList,
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ["lists"] });
      if (props.selectedListId === id) props.onSelectList(null);
    },
    onError: () => props.onActionError?.("Could not delete that list."),
  });
  const copyListFeedUrl = (token: string) => {
    const url = `${window.location.origin}/lists/${token}.xml`;
    navigator.clipboard.writeText(url).then(
      () => props.onActionError?.("RSS link copied."),
      () => props.onActionError?.(url),
    );
  };

  const total = (feeds.data ?? []).reduce((n, f) => n + f.unreadCount, 0);
  const ingestorByFeed = new Map((ingestors.data ?? []).map((i) => [i.feedId, i]));
  const pendingSuffix = (feedId: string) => {
    const ing = ingestorByFeed.get(feedId);
    return ing && ing.pendingCount > 0 && ing.digestMode !== "realtime" ? ` · +${ing.pendingCount}` : "";
  };

  if (props.collapsed) {
    return (
      <nav id="feeds-panel" className={`sidebar collapsed${props.open ? " open" : ""}`} aria-label="Feeds">
        <button className="panel-rail" onClick={props.onToggleCollapsed} aria-label="Expand feeds column" aria-expanded={false} aria-controls="feeds-panel">
          <span aria-hidden="true">›</span><span className="rail-label">Feeds</span>
        </button>
      </nav>
    );
  }

  return (
    <>
      <nav id="feeds-panel" className={`sidebar${props.open ? " open" : ""}`}>
        <div className="panel-head">
          <h2>Feeds</h2>
          <button className="panel-collapse" onClick={props.onToggleCollapsed} aria-label="Collapse feeds column" aria-expanded={true} aria-controls="feeds-panel">Collapse</button>
        </div>
        <div className="sidebar-actions" aria-label="Feed actions">
          <button
            className="sidebar-action primary"
            type="button"
            onClick={() => setWizardOpen(true)}
          >
            + Add source
          </button>
          <button className="sidebar-action" type="button" onClick={() => setCreateListOpen(true)}>+ List</button>
        </div>
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
                  {f.status === "broken" && <span className="warn-badge" title={f.lastError ?? "Feed is retrying automatically"}>⚠ </span>}
                  {feedPlatform(f.url) && <span className="platform-badge">{feedPlatform(f.url)}</span>}
                  {f.title}
                </span>
                <span className="count">{f.unreadCount}{pendingSuffix(f.id)}</span>
              </button>
              <span className="row-actions">
                {!feedPlatform(f.url) && <button
                  title={props.refreshingFeedId === f.id ? "Refreshing…" : "Refresh feed"}
                  aria-label={`Refresh ${f.title}`}
                  disabled={props.refreshingFeedId !== null}
                  onClick={() => props.onRefreshFeed(f.id)}
                >{props.refreshingFeedId === f.id ? "…" : "↻"}</button>}
                <button title="Mark all read" aria-label={`Mark all ${f.title} articles read`} onClick={() => markAll.mutate(f.id)}>✓</button>
                <button title="Unsubscribe" aria-label={`Unsubscribe from ${f.title}`} onClick={() => { if (confirm(`Unsubscribe from ${f.title}?`)) unsub.mutate(f.id); }}>×</button>
              </span>
            </li>
          ))}
        </ul>
        {(lists.data ?? []).length > 0 && (
          <>
            <div className="panel-head">
              <h2>Lists</h2>
            </div>
            <ul>
              {(lists.data ?? []).map((list) => (
                <li key={list.id} className={props.selectedListId === list.id ? "selected" : ""}>
                  <button onClick={() => props.onSelectList(list.id)}>
                    <span className="feed-title">
                      {list.visibility === "public" && <span className="platform-badge">public</span>}
                      {list.title}
                    </span>
                    <span className="count">{list.itemCount}</span>
                  </button>
                  <span className="row-actions">
                    {list.visibility === "public" && (
                      <button title="Copy RSS link" aria-label={`Copy RSS link for ${list.title}`} onClick={() => copyListFeedUrl(list.token)}>⧉</button>
                    )}
                    <button title="Delete list" aria-label={`Delete list ${list.title}`} onClick={() => { if (confirm(`Delete list ${list.title}? Articles stay in their feeds.`)) deleteList.mutate(list.id); }}>×</button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </nav>
      {props.drawer && props.open && <div className="backdrop" onClick={props.onCloseDrawer} />}
      {wizardOpen && <SourceWizard onClose={() => setWizardOpen(false)} />}
      <CreateListDialog open={createListOpen} onClose={() => setCreateListOpen(false)} onActionError={props.onActionError} />
    </>
  );
}
