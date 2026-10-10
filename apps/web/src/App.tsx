import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useParams } from "react-router";
import { api, ApiError, type Article } from "./api";
import { Sidebar } from "./Sidebar";
import { ArticleList } from "./ArticleList";
import { ArticleView, snoozePresets } from "./ArticleView";
import { ColumnResizer } from "./ColumnResizer";
import { ShortcutHints } from "./ShortcutHints";
import { listIdForKey, useListShortcuts } from "./listShortcuts";
import { useTheme, toggleTheme } from "./theme";
import { isStandalone, promptInstall } from "./installPrompt";
import { useMediaQuery } from "./useMediaQuery";
import { useColumnLayout } from "./useColumnLayout";
import { idFromRouteKey, safeUrl } from "./urls";
import { navNeighbor } from "./articleNav";
import { PlayerDock } from "./PlayerDock";
import { currentItem, enqueue, isPlayable, playAll, playNow, queueItem, updateQueue, usePlayQueue, type QueueItem } from "./playQueue";
import { streamArticlePath, streamFromParams, streamKey, streamPath, streamQuery, streamTitle, type Stream, type StreamTitles } from "./streams";

/** Two paths that differ only in how they are percent-escaped are the same address. */
function samePath(a: string, b: string): boolean {
  try {
    return decodeURIComponent(a) === decodeURIComponent(b);
  } catch {
    // A hand-typed address with a broken escape cannot be compared; leave it alone.
    return true;
  }
}

/** How many playable items "Play" pulls from a stream into the queue. */
const PLAY_STREAM_LIMIT = 200;

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams<{ feedId?: string; listId?: string; feedCategory?: string; feedKind?: string; articleId?: string }>();
  const stream = streamFromParams(params);
  const streamId = streamKey(stream);
  const feedId = stream.kind === "feed" ? stream.feedId : null;
  const articleId = params.articleId ? idFromRouteKey(params.articleId) : null;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [navDir, setNavDir] = useState<"prev" | "next" | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const [shortcutHelp, setShortcutHelp] = useState(false);
  const [shortcutNotice, setShortcutNotice] = useState<string | null>(null);
  // Unread-only navigation: prev/next (buttons, swipe, j/k) skip read articles.
  const [unreadNav, setUnreadNav] = useState(() => localStorage.getItem("reader.unreadNav") === "1");
  const toggleUnreadNav = () => setUnreadNav((on) => {
    localStorage.setItem("reader.unreadNav", on ? "0" : "1");
    return !on;
  });
  const theme = useTheme();
  const isNarrow = useMediaQuery("(max-width: 1099px)");
  const isMobile = useMediaQuery("(max-width: 699px)");
  const { layout, resize, toggle } = useColumnLayout();
  const qc = useQueryClient();
  const feeds = useQuery({ queryKey: ["feeds"], queryFn: api.listFeeds, refetchInterval: 60_000 });
  const lists = useQuery({ queryKey: ["lists"], queryFn: api.listLists });

  const PAGE_SIZE = 50;
  const articles = useInfiniteQuery({
    queryKey: ["articles", streamId, category],
    queryFn: ({ pageParam }) => api.listArticles({
      ...streamQuery(stream),
      ...(category ? { category } : {}),
      limit: PAGE_SIZE,
      ...pageParam,
    }),
    initialPageParam: {} as { before?: string; beforeId?: string },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    // Keep the outgoing pages on screen while a subject switch loads, so the
    // list never collapses to the skeleton (which would also reset scroll).
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const categories = useQuery({
    queryKey: ["categories", feedId],
    queryFn: () => api.listCategories(feedId ?? undefined),
    // Subjects are counted per feed or across everything; a list, category or
    // type would show counts for articles that are not in it.
    enabled: stream.kind === "all" || stream.kind === "feed",
  });
  // Switching feeds, lists, or filters invalidates the cursor position; the
  // query key already resets pages, but a stale selection must not survive either.
  useEffect(() => { setCategory(null); }, [streamId]);
  const articleList = articles.data?.pages.flatMap((page) => page.articles) ?? [];
  const articleFromList = articleList.find((item) => item.id === articleId);
  const deepArticle = useQuery({
    queryKey: ["article", articleId],
    queryFn: () => api.getArticle(articleId!),
    enabled: Boolean(articleId),
    retry: false,
  });
  const article = deepArticle.data ?? null;
  const selectedArticle = article ?? articleFromList ?? null;
  const selectedListTitle = (id: string | null) => lists.data?.find((list) => list.id === id)?.title ?? null;
  const titles: StreamTitles = {
    feed: (id) => feeds.data?.find((feed) => feed.id === id)?.title ?? null,
    list: selectedListTitle,
  };
  const articleHref = (target: Pick<Article, "id" | "feedId" | "title">) => streamArticlePath(stream, target, titles);
  const queue = usePlayQueue();

  const refresh = useMutation({
    mutationFn: api.refreshFeed,
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["feeds"] });
      qc.invalidateQueries({ queryKey: ["articles"] });
      setShortcutNotice(result.newArticles > 0 ? `Added ${result.newArticles} new article${result.newArticles === 1 ? "" : "s"}.` : "Feed is up to date.");
    },
    onError: (error) => {
      qc.invalidateQueries({ queryKey: ["feeds"] });
      setShortcutNotice(error instanceof ApiError ? error.message : "Could not refresh the feed.");
    },
  });

  const setRead = useMutation({
    mutationFn: ({ id, read }: { id: string; read: boolean }) => api.setRead(id, read),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["articles"] });
      qc.invalidateQueries({ queryKey: ["feeds"] });
    },
    onError: () => setShortcutNotice("Could not update read state."),
  });

  const snooze = useMutation({
    mutationFn: ({ id, until }: { id: string; until: string | null }) => api.setSnooze(id, until),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["articles"] });
      qc.invalidateQueries({ queryKey: ["feeds"] });
      qc.invalidateQueries({ queryKey: ["article", vars.id] });
      setShortcutNotice(vars.until ? `Snoozed until ${new Date(vars.until).toLocaleString()}.` : "Snooze removed.");
    },
    onError: () => setShortcutNotice("Could not snooze that article."),
  });

  const listShortcuts = useListShortcuts();
  const saveToList = useMutation({
    mutationFn: ({ listId, articleId, save }: { listId: string; articleId: string; save: boolean }) =>
      save ? api.addToList(listId, articleId) : api.removeFromList(listId, articleId),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["lists"] });
      qc.invalidateQueries({ queryKey: ["articles"] });
      qc.invalidateQueries({ queryKey: ["article", vars.articleId] });
      const title = selectedListTitle(vars.listId) ?? "list";
      setShortcutNotice(vars.save ? `Saved to “${title}”.` : `Removed from “${title}”.`);
    },
    onError: () => setShortcutNotice("Could not update that list."),
  });

  useEffect(() => {
    if (!shortcutNotice) return;
    const timer = window.setTimeout(() => setShortcutNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [shortcutNotice]);

  const selectStream = (next: Stream) => { navigate(streamPath(next, titles)); setDrawerOpen(false); };

  // Play a stream: its audio and video, in the stream's own order, replace the queue.
  const playStream = useMutation({
    mutationFn: () => api.listArticles({ ...streamQuery(stream), media: "any", limit: PLAY_STREAM_LIMIT }),
    onSuccess: (page) => {
      const name = streamTitle(stream, titles);
      if (page.articles.length === 0) return setShortcutNotice(`Nothing to play in “${name}”.`);
      updateQueue(() => playAll(page.articles.map(queueItem), name));
      setShortcutNotice(`Playing ${page.articles.length}${page.nextCursor ? "+" : ""} from “${name}”.`);
    },
    onError: () => setShortcutNotice("Could not load that stream to play."),
  });
  const queueArticle = (target: Article, play: boolean) => {
    if (!isPlayable(target)) return setShortcutNotice("This article has no audio or video.");
    updateQueue((q) => (play ? playNow(q, queueItem(target)) : enqueue(q, queueItem(target))));
    if (!play) setShortcutNotice(`Added “${target.title}” to the queue.`);
  };
  const openQueueItem = (item: QueueItem) => navigate(streamArticlePath({ kind: "feed", feedId: item.feedId }, item, titles));
  const selectArticle = (next: Article) => { setNavDir(null); navigate(articleHref(next)); setDrawerOpen(false); };
  const goArticle = (target: Article, dir: "prev" | "next") => {
    setNavDir(dir);
    navigate(articleHref(target));
    if (!target.readAt) setRead.mutate({ id: target.id, read: true });
  };
  const showReader = isMobile && (article !== null || articleId !== null);

  const list = articleList;
  const currentIndex = selectedArticle ? list.findIndex((item) => item.id === selectedArticle.id) : -1;
  const prevArticle = navNeighbor(list, currentIndex, "prev", unreadNav);
  const nextArticle = navNeighbor(list, currentIndex, "next", unreadNav);

  // Unread-only nav can run dry inside the loaded pages while more unread
  // articles sit on the server; pull the next page so the trail continues.
  useEffect(() => {
    if (!unreadNav || currentIndex < 0 || nextArticle) return;
    if (articles.hasNextPage && !articles.isFetchingNextPage) void articles.fetchNextPage();
  }, [unreadNav, currentIndex, nextArticle, articles.hasNextPage, articles.isFetchingNextPage, articles.fetchNextPage]);

  useEffect(() => {
    if (!feeds.data) return;
    // The address carries titles for readability; once they are known, settle
    // on the one true spelling. Compared decoded: the router hands back
    // pathname with its own escaping, which differs from encodeURIComponent's.
    const canonical = article ? articleHref(article) : articleId || stream.kind === "all" ? null : streamPath(stream, titles);
    if (canonical && !samePath(location.pathname, canonical)) navigate(canonical, { replace: true });
  }, [article, articleId, streamId, feeds.data, lists.data, location.pathname, navigate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || event.isComposing || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")) return;
      // A modal dialog (add-feed, ingestor, feed picker) owns the keyboard; don't
      // let list/refresh shortcuts fire behind it.
      if (document.querySelector("dialog[open]")) return;
      if (event.key === "Escape") {
        if (shortcutHelp) setShortcutHelp(false);
        return;
      }
      if (event.key === "?") {
        event.preventDefault();
        setShortcutHelp((open) => !open);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const list = articleList;
      if (event.key === "j" || event.key === "k") {
        event.preventDefault();
        const dir = event.key === "j" ? "next" : "prev";
        const current = selectedArticle ? list.findIndex((item) => item.id === selectedArticle.id) : -1;
        const next = current < 0 ? list[0] : navNeighbor(list, current, dir, unreadNav);
        if (next) {
          setNavDir(dir);
          navigate(articleHref(next));
          // Browsing with j/k reads like clicking: the article you land on is read.
          if (!next.readAt) setRead.mutate({ id: next.id, read: true });
        }
        return;
      }
      if (event.key === "s" || event.key === "t" || event.key === "w") {
        event.preventDefault();
        if (!selectedArticle) {
          setShortcutNotice("Select an article before snoozing.");
          return;
        }
        const preset = snoozePresets(new Date()).find((p) => p.key === event.key);
        if (preset) snooze.mutate({ id: selectedArticle.id, until: preset.until.toISOString() });
        return;
      }
      if (event.key === "u") {
        event.preventDefault();
        if (!selectedArticle) {
          setShortcutNotice("Select an article before unsnoozing.");
          return;
        }
        if (!selectedArticle.snoozedUntil) {
          setShortcutNotice("This article is not snoozed.");
          return;
        }
        snooze.mutate({ id: selectedArticle.id, until: null });
        return;
      }
      if (event.key === "r") {
        event.preventDefault();
        const refreshId = feedId ?? selectedArticle?.feedId ?? null;
        if (refreshId) refresh.mutate(refreshId);
        else setShortcutNotice("Select a feed before refreshing it.");
        return;
      }
      if (event.key === "p" || event.key === "q") {
        event.preventDefault();
        if (selectedArticle) queueArticle(selectedArticle, event.key === "p");
        else setShortcutNotice("Select an article before playing it.");
        return;
      }
      if (event.key === "o") {
        const href = safeUrl(selectedArticle?.url ?? null);
        if (href) window.open(href, "_blank", "noopener,noreferrer");
        else setShortcutNotice("This article has no safe original link.");
        return;
      }
      if (event.key === "[") toggle("sidebar");
      if (event.key === "]") toggle("list");
      // User-configured list shortcuts: one key saves (or unsaves) the
      // current article to a specific list.
      const shortcutListId = event.key.length === 1 ? listIdForKey(event.key) : null;
      if (shortcutListId) {
        event.preventDefault();
        if (!selectedArticle) {
          setShortcutNotice("Select an article before saving to a list.");
          return;
        }
        const member = selectedArticle.listIds?.includes(shortcutListId) ?? false;
        saveToList.mutate({ listId: shortcutListId, articleId: selectedArticle.id, save: !member });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // refresh.mutate is stable; depending on the mutation object would re-bind the
    // listener every render.
  }, [articleList, streamId, feeds.data, lists.data, listShortcuts, navigate, refresh.mutate, snooze.mutate, saveToList.mutate, setRead.mutate, selectedArticle, shortcutHelp, toggle, unreadNav]);

  const loadMore = useCallback(() => {
    if (articles.hasNextPage && !articles.isFetchingNextPage) void articles.fetchNextPage();
  }, [articles.hasNextPage, articles.isFetchingNextPage, articles.fetchNextPage]);

  const gridStyle = {
    "--sidebar-width": `${layout.sidebarCollapsed ? 52 : layout.sidebarWidth}px`,
    "--list-width": `${layout.listCollapsed ? 52 : layout.listWidth}px`,
  } as CSSProperties;

  return (
    <div className={`app${currentItem(queue) ? " has-dock" : ""}`}>
      <header className="header">
        {isNarrow && (
          <button className="icon-btn hamburger" aria-label="Toggle feeds" onClick={() => setDrawerOpen((v) => !v)}>☰</button>
        )}
        <h1 className="brand">Reader</h1>
        {import.meta.env.VITE_DEMO === "1" && (
          <span className="demo-banner">
            Demo — bundled content, changes stay in this browser.{" "}
            <a href="https://github.com/standardbeagle/reader">Get reader</a>
          </span>
        )}
        <span className="spacer" />
        <button
          className="icon-btn"
          aria-label="Jump between unread articles only"
          aria-pressed={unreadNav}
          title="Jump between unread articles only"
          onClick={toggleUnreadNav}
        >‹•›</button>
        {!isStandalone() && (
          <button
            className="icon-btn"
            aria-label="Install app"
            title="Install app"
            onClick={() => { if (!promptInstall()) setInstallHelpOpen(true); }}
          >⤓</button>
        )}
        <button className="icon-btn" aria-label="Toggle theme" onClick={toggleTheme}>
          {theme === "dark" ? "☀" : "☾"}
        </button>
      </header>
      <div className={`layout${showReader ? " show-reader" : ""}${layout.readerCollapsed ? " reader-collapsed" : ""}`} style={gridStyle}>
        <Sidebar
          stream={stream}
          onSelectStream={selectStream}
          open={!isNarrow || drawerOpen}
          drawer={isNarrow}
          onCloseDrawer={() => setDrawerOpen(false)}
          collapsed={layout.sidebarCollapsed}
          onToggleCollapsed={() => toggle("sidebar")}
          onRefreshFeed={(id) => refresh.mutate(id)}
          refreshingFeedId={refresh.isPending ? (refresh.variables ?? null) : null}
          onActionError={setShortcutNotice}
        />
        <ColumnResizer className="sidebar-resizer" label="Resize feeds column" value={layout.sidebarWidth} onResize={(delta) => resize("sidebar", delta)} />
        <ArticleList
          articles={articleList}
          loading={articles.isLoading}
          selectedId={articleId ?? article?.id ?? null}
          onSelect={selectArticle}
          categories={categories.data ?? []}
          selectedCategory={category}
          onSelectCategory={setCategory}
          hasMore={articles.hasNextPage}
          loadingMore={articles.isFetchingNextPage}
          onLoadMore={loadMore}
          collapsed={layout.listCollapsed}
          onToggleCollapsed={() => toggle("list")}
          onActionError={setShortcutNotice}
          title={streamTitle(stream, titles)}
          onPlayStream={() => playStream.mutate()}
          playingStream={playStream.isPending}
          onQueue={(target) => queueArticle(target, false)}
        />
        <ColumnResizer className="list-resizer" label="Resize articles column" value={layout.listWidth} onResize={(delta) => resize("list", delta)} />
        <ArticleView
          article={selectedArticle}
          loading={Boolean(articleId && (articles.isLoading || deepArticle.isLoading) && !selectedArticle)}
          contentLoading={Boolean(articleId && deepArticle.isPending)}
          requested={articleId !== null}
          error={deepArticle.isError && !selectedArticle}
          prevArticle={prevArticle}
          nextArticle={nextArticle}
          onNavArticle={goArticle}
          navDir={navDir}
          onBack={isMobile ? () => navigate(streamPath(stream.kind === "all" && selectedArticle ? { kind: "feed", feedId: selectedArticle.feedId } : stream, titles)) : undefined}
          collapsed={layout.readerCollapsed}
          onToggleCollapsed={() => toggle("reader")}
          onActionError={setShortcutNotice}
        />
      </div>
      {installHelpOpen && (
        <div className="overlay" onClick={() => setInstallHelpOpen(false)}>
          <div className="picker" role="dialog" aria-modal="true" aria-label="Install Reader" onClick={(event) => event.stopPropagation()}>
            <h2>Install Reader</h2>
            <p className="sub">Add Reader to your home screen for a full-screen, app-like experience.</p>
            <ul className="install-steps">
              <li><strong>iPhone / iPad (Safari):</strong> tap the Share button, then “Add to Home Screen”.</li>
              <li><strong>Android (Chrome):</strong> open the ⋮ menu, then “Install app” or “Add to Home screen”.</li>
              <li><strong>Desktop (Chrome / Edge):</strong> click the install icon in the address bar.</li>
            </ul>
            <button className="cancel" onClick={() => setInstallHelpOpen(false)}>Close</button>
          </div>
        </div>
      )}
      <PlayerDock onOpen={openQueueItem} onPlayed={(item) => setRead.mutate({ id: item.id, read: true })} />
      <ShortcutHints
        open={shortcutHelp}
        notice={shortcutNotice}
        onToggle={() => setShortcutHelp((open) => !open)}
        listShortcuts={Object.entries(listShortcuts).map(([id, key]) => [key, `save to “${selectedListTitle(id) ?? "list"}”`])}
      />
    </div>
  );
}
