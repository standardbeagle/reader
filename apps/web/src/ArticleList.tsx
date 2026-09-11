import { Fragment, useEffect, useMemo, useRef, useState, type UIEvent as ReactUIEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Article, type CategoryCount } from "./api";
import { safeUrl } from "./urls";
import { useMediaQuery } from "./useMediaQuery";

function dayKeyOf(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(key: string, now: Date): string {
  const parts = key.split("-").map(Number);
  const y = parts[0]!, m = parts[1]!, d = parts[2]!;
  const date = new Date(y, m, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((today.getTime() - date.getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  const base = date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return y === now.getFullYear() ? base : `${base}, ${y}`;
}

export interface DayGroup { key: string; label: string; items: Article[] }

export function groupByDay(articles: Article[], now: Date): DayGroup[] {
  const groups: DayGroup[] = [];
  let undated: Article[] | null = null;
  for (const a of articles) {
    const key = dayKeyOf(a.publishedAt);
    if (!key) {
      (undated ??= []).push(a);
      continue;
    }
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = { key, label: dayLabel(key, now), items: [] };
      groups.push(group);
    }
    group.items.push(a);
  }
  if (undated) groups.push({ key: "earlier", label: "Earlier", items: undated });
  return groups;
}

export function ArticleList(props: {
  articles: Article[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (a: Article) => void;
  categories: CategoryCount[];
  selectedCategory: string | null;
  onSelectCategory: (name: string | null) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onActionError?: (message: string) => void;
}) {
  const qc = useQueryClient();
  const setRead = useMutation({
    mutationFn: ({ id, read }: { id: string; read: boolean }) => api.setRead(id, read),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["articles"] });
      qc.invalidateQueries({ queryKey: ["feeds"] });
    },
    onError: () => props.onActionError?.("Could not update read state."),
  });
  const isMobile = useMediaQuery("(max-width: 699px)");
  const groups = useMemo(() => groupByDay(props.articles, new Date()), [props.articles]);
  const [view, setView] = useState<"list" | "board">(
    () => (localStorage.getItem("reader.articleView") === "board" ? "board" : "list"),
  );
  const toggleView = () => {
    const next = view === "list" ? "board" : "list";
    setView(next);
    localStorage.setItem("reader.articleView", next);
  };

  // Infinite scroll: a sentinel row at the end of the list triggers the next
  // page fetch before the user reaches the bottom; a button covers keyboard
  // and reduced-motion cases where the observer may not fire.
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !props.hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) props.onLoadMore(); },
      { rootMargin: "480px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [props.hasMore, props.onLoadMore, props.articles.length]);

  // Secondary trigger: IntersectionObserver over a nested scroll container is
  // unreliable on some mobile WebKit builds, so also fetch when the user
  // scrolls near the bottom. fetchNextPage dedupes concurrent calls.
  const onListScroll = (event: ReactUIEvent<HTMLElement>) => {
    if (!props.hasMore) return;
    const el = event.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 600) props.onLoadMore();
  };

  if (props.collapsed) {
    return (
      <section id="article-list-panel" className="list collapsed" role="region" aria-label="Article list">
        <button className="panel-rail" onClick={props.onToggleCollapsed} aria-label="Expand article list column" aria-expanded={false} aria-controls="article-list-panel">
          <span aria-hidden="true">›</span><span className="rail-label">Articles</span>
        </button>
      </section>
    );
  }

  // One section for every data state: the panel head and the chip row never
  // unmount, so selecting a subject (which swaps the body while the filtered
  // page loads) cannot reset the chip row's horizontal scroll position.
  const renderRow = (a: Article) => (
    <li
      key={a.id}
      className={`${a.readAt ? "read" : "unread"} ${props.selectedId === a.id ? "selected" : ""}`}
    >
      <button onClick={() => openArticle(a)}>
        <span className="t">{a.media && <span className="episode-badge" aria-label="Episode">{a.media.type?.startsWith("video/") ? "▶" : "♪"}</span>}{a.title}</span>
      </button>
      <span className="date">{a.publishedAt ? new Date(a.publishedAt).toLocaleDateString() : ""}</span>
    </li>
  );

  const openArticle = (a: Article) => {
    props.onSelect(a);
    if (!a.readAt) setRead.mutate({ id: a.id, read: true });
  };

  const renderCard = (a: Article) => {
    const hero = safeUrl(a.imageUrl ?? null);
    return (
      <button
        key={a.id}
        className={`pin-card ${a.readAt ? "read" : "unread"} ${props.selectedId === a.id ? "selected" : ""}`}
        onClick={() => openArticle(a)}
      >
        {hero ? (
          <img className="pin-hero" src={hero} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className="pin-hero pin-fallback" aria-hidden="true">{a.title.charAt(0).toUpperCase()}</span>
        )}
        <span className="pin-title">{a.title}</span>
        <span className="pin-date">{a.publishedAt ? new Date(a.publishedAt).toLocaleDateString() : ""}</span>
      </button>
    );
  };

  const loadMoreUi = props.hasMore && (
    <>
      <div ref={sentinelRef} className="load-sentinel" aria-hidden="true" />
      <button className="load-more-btn" onClick={props.onLoadMore} disabled={props.loadingMore}>
        {props.loadingMore ? "Loading…" : "Load more"}
      </button>
    </>
  );

  const body = props.loading ? (
    <div className="skel" aria-busy="true">
      {[0, 1, 2, 3, 4, 5].map((i) => <div className="bar" key={i} />)}
    </div>
  ) : props.articles.length === 0 ? (
    <div className="empty">{props.selectedCategory ? "Nothing filed under this subject." : "No articles."}</div>
  ) : view === "board" ? (
    <>
      <div className="pinboard">{props.articles.map(renderCard)}</div>
      {loadMoreUi}
    </>
  ) : (
    <>
      <ul>
        {groups.map((group) => (
          <Fragment key={group.key}>
            {isMobile && <li className="date-head"><span>{group.label}</span></li>}
            {group.items.map(renderRow)}
          </Fragment>
        ))}
      </ul>
      {loadMoreUi}
    </>
  );

  return (
    <section
      id="article-list-panel"
      className="list"
      role="region"
      aria-label="Article list"
      aria-busy={props.loading || undefined}
      onScroll={onListScroll}
    >
      <div className="panel-head">
        <h2>Articles</h2>
        <div className="head-actions">
          <button
            className="view-toggle"
            onClick={toggleView}
            aria-pressed={view === "board"}
            title={view === "board" ? "Switch to list view" : "Switch to pinboard view"}
          >
            {view === "board" ? "☰" : "▦"}
          </button>
          <button className="panel-collapse" onClick={props.onToggleCollapsed} aria-expanded={true} aria-controls="article-list-panel">Collapse</button>
        </div>
      </div>
      <FilterChips {...props} />
      {body}
    </section>
  );
}

function FilterChips(props: {
  categories: CategoryCount[];
  selectedCategory: string | null;
  onSelectCategory: (name: string | null) => void;
}) {
  if (props.categories.length === 0) return null;
  return (
    <div className="cat-chips" role="group" aria-label="Filter articles by subject">
      <button
        className={`cat-chip${props.selectedCategory === null ? " selected" : ""}`}
        aria-pressed={props.selectedCategory === null}
        onClick={() => props.onSelectCategory(null)}
      >All</button>
      {props.categories.map((c) => (
        <button
          key={c.name}
          className={`cat-chip${props.selectedCategory === c.name ? " selected" : ""}`}
          aria-pressed={props.selectedCategory === c.name}
          onClick={() => props.onSelectCategory(props.selectedCategory === c.name ? null : c.name)}
        >
          {c.name}<span className="cat-count">{c.count}</span>
        </button>
      ))}
    </div>
  );
}
