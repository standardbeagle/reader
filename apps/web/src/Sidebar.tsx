import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, feedPlatform, type Feed } from "./api";
import { SourceWizard } from "./SourceWizard";
import { CreateListDialog } from "./ListDialogs";
import { AccountsDialog } from "./Accounts";
import { FeedCategoryDialog } from "./FeedCategoryDialog";
import { groupFeeds, streamKey, type FeedGrouping, type Stream } from "./streams";

const GROUPING_KEY = "reader.feedGrouping";
const GROUPINGS: readonly FeedGrouping[] = ["category", "type", "none"];

export function Sidebar(props: {
  stream: Stream;
  onSelectStream: (stream: Stream) => void;
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
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [categoryFeed, setCategoryFeed] = useState<Feed | null>(null);
  const [grouping, setGrouping] = useState<FeedGrouping>(
    () => GROUPINGS.find((g) => g === localStorage.getItem(GROUPING_KEY)) ?? "category",
  );
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
      if (props.stream.kind === "list" && props.stream.listId === id) props.onSelectStream({ kind: "all" });
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
  const chooseGrouping = (next: FeedGrouping) => {
    setGrouping(next);
    localStorage.setItem(GROUPING_KEY, next);
  };

  const allFeeds = feeds.data ?? [];
  const total = allFeeds.reduce((n, f) => n + f.unreadCount, 0);
  const ingestorByFeed = new Map((ingestors.data ?? []).map((i) => [i.feedId, i]));
  const pendingSuffix = (feedId: string) => {
    const ing = ingestorByFeed.get(feedId);
    return ing && ing.pendingCount > 0 && ing.digestMode !== "realtime" ? ` · +${ing.pendingCount}` : "";
  };
  const selected = streamKey(props.stream);
  const isSelected = (stream: Stream) => streamKey(stream) === selected;
  const grouped = groupFeeds(allFeeds, grouping);
  // Before any feed has a category, one "Uncategorized" heading over everything says nothing.
  const groups = grouped.length === 1 && !grouped[0]!.stream ? [] : grouped;
  const categories = [...new Set(allFeeds.flatMap((f) => (f.category ? [f.category] : [])))].sort((a, b) => a.localeCompare(b));

  if (props.collapsed) {
    return (
      <nav id="feeds-panel" className={`sidebar collapsed${props.open ? " open" : ""}`} aria-label="Feeds">
        <button className="panel-rail" onClick={props.onToggleCollapsed} aria-label="Expand feeds column" aria-expanded={false} aria-controls="feeds-panel">
          <span aria-hidden="true">›</span><span className="rail-label">Feeds</span>
        </button>
      </nav>
    );
  }

  const feedRow = (f: Feed) => {
    const platform = feedPlatform(f.url);
    return (
      <li key={f.id} className={isSelected({ kind: "feed", feedId: f.id }) ? "selected" : ""}>
        <button onClick={() => props.onSelectStream({ kind: "feed", feedId: f.id })}>
          <span className="feed-title">
            {f.status === "broken" && <span className="warn-badge" title={f.lastError ?? "Feed is retrying automatically"}>⚠ </span>}
            {platform && <span className="platform-badge">{platform}</span>}
            {f.title}
          </span>
          <span className="count">{f.unreadCount}{pendingSuffix(f.id)}</span>
        </button>
        <span className="row-actions">
          {!platform && <button
            title={props.refreshingFeedId === f.id ? "Refreshing…" : "Refresh feed"}
            aria-label={`Refresh ${f.title}`}
            disabled={props.refreshingFeedId !== null}
            onClick={() => props.onRefreshFeed(f.id)}
          >{props.refreshingFeedId === f.id ? "…" : "↻"}</button>}
          <button
            title={f.category ? `Category: ${f.category}` : "Set a category"}
            aria-label={`Set the category of ${f.title}`}
            onClick={() => setCategoryFeed(f)}
          >▤</button>
          <button title="Mark all read" aria-label={`Mark all ${f.title} articles read`} onClick={() => markAll.mutate(f.id)}>✓</button>
          <button title="Unsubscribe" aria-label={`Unsubscribe from ${f.title}`} onClick={() => { if (confirm(`Unsubscribe from ${f.title}?`)) unsub.mutate(f.id); }}>×</button>
        </span>
      </li>
    );
  };

  return (
    <>
      <nav id="feeds-panel" className={`sidebar${props.open ? " open" : ""}`}>
        <div className="panel-head">
          <h2>Feeds</h2>
          <div className="head-actions">
            <select
              className="group-select"
              aria-label="Group feeds by"
              title="Group feeds by"
              value={grouping}
              onChange={(event) => chooseGrouping(event.target.value as FeedGrouping)}
            >
              <option value="category">By category</option>
              <option value="type">By type</option>
              <option value="none">Ungrouped</option>
            </select>
            <button className="panel-collapse" onClick={props.onToggleCollapsed} aria-label="Collapse feeds column" aria-expanded={true} aria-controls="feeds-panel">Collapse</button>
          </div>
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
          <button className="sidebar-action" type="button" onClick={() => setAccountsOpen(true)}>Accounts</button>
        </div>
        <ul>
          <li className={props.stream.kind === "all" ? "selected" : ""}>
            <button onClick={() => props.onSelectStream({ kind: "all" })}>
              <span className="feed-title">All items</span>
              <span className="count">{total}</span>
            </button>
          </li>
          {groups.length === 0 ? allFeeds.map(feedRow) : groups.map((group) => (
            <li key={group.key} className="feed-group">
              <div className={`feed-group-head${group.stream && isSelected(group.stream) ? " selected" : ""}`}>
                {group.stream ? (
                  <button onClick={() => props.onSelectStream(group.stream!)} title={`Show everything in ${group.label}`}>
                    <span className="feed-title">{group.label}</span>
                    <span className="count">{group.unreadCount}</span>
                  </button>
                ) : (
                  <span className="feed-group-label"><span className="feed-title">{group.label}</span><span className="count">{group.unreadCount}</span></span>
                )}
              </div>
              <ul>{group.feeds.map(feedRow)}</ul>
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
                <li key={list.id} className={isSelected({ kind: "list", listId: list.id }) ? "selected" : ""}>
                  <button onClick={() => props.onSelectStream({ kind: "list", listId: list.id })}>
                    <span className="feed-title">
                      {list.rule && <span className="platform-badge" title="Fills itself from a rule">auto</span>}
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
      {accountsOpen && <AccountsDialog onClose={() => setAccountsOpen(false)} />}
      {categoryFeed && <FeedCategoryDialog feed={categoryFeed} categories={categories} onClose={() => setCategoryFeed(null)} onActionError={props.onActionError} />}
      <CreateListDialog open={createListOpen} onClose={() => setCreateListOpen(false)} onActionError={props.onActionError} />
    </>
  );
}
