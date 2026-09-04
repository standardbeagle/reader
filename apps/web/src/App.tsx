import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useParams } from "react-router";
import { api, ApiError, type Article } from "./api";
import { Sidebar } from "./Sidebar";
import { ArticleList } from "./ArticleList";
import { ArticleView } from "./ArticleView";
import { ColumnResizer } from "./ColumnResizer";
import { ShortcutHints } from "./ShortcutHints";
import { useTheme, toggleTheme } from "./theme";
import { isStandalone, promptInstall } from "./installPrompt";
import { useMediaQuery } from "./useMediaQuery";
import { useColumnLayout } from "./useColumnLayout";
import { idFromRouteKey, routeKey, safeUrl } from "./urls";

function feedPath(feedId: string | null, feedTitle?: string | null): string {
  return feedId ? `/feeds/${routeKey(feedTitle ?? "feed", feedId)}` : "/";
}

function articlePath(article: Article, feedTitle?: string | null): string {
  return `/feeds/${routeKey(feedTitle ?? "feed", article.feedId)}/articles/${routeKey(article.title, article.id)}`;
}

function listPath(listId: string, listTitle?: string | null): string {
  return `/lists/${routeKey(listTitle ?? "list", listId)}`;
}

function listArticlePath(article: Article, listId: string, listTitle?: string | null): string {
  return `${listPath(listId, listTitle)}/articles/${routeKey(article.title, article.id)}`;
}

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams<{ feedId?: string; listId?: string; articleId?: string }>();
  const feedId = params.feedId ? idFromRouteKey(params.feedId) : null;
  const listId = params.listId ? idFromRouteKey(params.listId) : null;
  const articleId = params.articleId ? idFromRouteKey(params.articleId) : null;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [navDir, setNavDir] = useState<"prev" | "next" | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const [shortcutHelp, setShortcutHelp] = useState(false);
  const [shortcutNotice, setShortcutNotice] = useState<string | null>(null);
  const theme = useTheme();
  const isNarrow = useMediaQuery("(max-width: 1099px)");
  const isMobile = useMediaQuery("(max-width: 699px)");
  const { layout, resize, toggle } = useColumnLayout();
  const qc = useQueryClient();
  const feeds = useQuery({ queryKey: ["feeds"], queryFn: api.listFeeds, refetchInterval: 60_000 });
  const lists = useQuery({ queryKey: ["lists"], queryFn: api.listLists });

  const PAGE_SIZE = 50;
  const articles = useInfiniteQuery({
    queryKey: ["articles", feedId, listId, category],
    queryFn: ({ pageParam }) => api.listArticles({
      ...(feedId ? { feedId } : {}),
      ...(listId ? { listId } : {}),
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
    // Subjects are a feed-level filter; saved lists have their own membership.
    enabled: !listId,
  });
  // Switching feeds, lists, or filters invalidates the cursor position; the
  // query key already resets pages, but a stale selection must not survive either.
  useEffect(() => { setCategory(null); }, [feedId, listId]);
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
  const selectedFeedTitle = (id: string | null) => feeds.data?.find((feed) => feed.id === id)?.title ?? null;
  const selectedListTitle = (id: string | null) => lists.data?.find((list) => list.id === id)?.title ?? null;
  const articleHref = (target: Article) =>
    listId ? listArticlePath(target, listId, selectedListTitle(listId)) : articlePath(target, selectedFeedTitle(target.feedId));

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

  useEffect(() => {
    if (!shortcutNotice) return;
    const timer = window.setTimeout(() => setShortcutNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [shortcutNotice]);

  const selectFeed = (id: string | null) => { navigate(feedPath(id, selectedFeedTitle(id))); setDrawerOpen(false); };
  const selectList = (id: string | null) => { navigate(id ? listPath(id, selectedListTitle(id)) : "/"); setDrawerOpen(false); };
  const selectArticle = (next: Article) => { setNavDir(null); navigate(articleHref(next)); setDrawerOpen(false); };
  const goArticle = (target: Article, dir: "prev" | "next") => {
    setNavDir(dir);
    navigate(articleHref(target));
    if (!target.readAt) setRead.mutate({ id: target.id, read: true });
  };
  const showReader = isMobile && (article !== null || articleId !== null);

  const list = articleList;
  const currentIndex = selectedArticle ? list.findIndex((item) => item.id === selectedArticle.id) : -1;
  const prevArticle = currentIndex > 0 ? list[currentIndex - 1] ?? null : null;
  const nextArticle = currentIndex >= 0 && currentIndex < list.length - 1 ? list[currentIndex + 1] ?? null : null;

  useEffect(() => {
    if (!feeds.data) return;
    if (article) {
      const canonical = listId
        ? listArticlePath(article, listId, selectedListTitle(listId))
        : articlePath(article, selectedFeedTitle(article.feedId));
      if (location.pathname !== canonical) navigate(canonical, { replace: true });
      return;
    }
    if (listId && !articleId) {
      const canonical = listPath(listId, selectedListTitle(listId));
      if (location.pathname !== canonical) navigate(canonical, { replace: true });
      return;
    }
    if (feedId && !articleId) {
      const canonical = feedPath(feedId, selectedFeedTitle(feedId));
      if (location.pathname !== canonical) navigate(canonical, { replace: true });
    }
  }, [article, articleId, feedId, listId, feeds.data, lists.data, location.pathname, navigate]);

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
        const current = selectedArticle ? list.findIndex((item) => item.id === selectedArticle.id) : -1;
        const nextIndex = event.key === "j"
          ? Math.min(list.length - 1, current + 1)
          : Math.max(0, current < 0 ? 0 : current - 1);
        const next = list[nextIndex];
        if (next) {
          setNavDir(event.key === "j" ? "next" : "prev");
          navigate(articleHref(next));
        }
        return;
      }
      if (event.key === "r") {
        event.preventDefault();
        const refreshId = feedId ?? selectedArticle?.feedId ?? null;
        if (refreshId) refresh.mutate(refreshId);
        else setShortcutNotice("Select a feed before refreshing it.");
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
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // refresh.mutate is stable; depending on the mutation object would re-bind the
    // listener every render.
  }, [articleList, feedId, listId, feeds.data, lists.data, navigate, refresh.mutate, selectedArticle, shortcutHelp, toggle]);

  const loadMore = useCallback(() => {
    if (articles.hasNextPage && !articles.isFetchingNextPage) void articles.fetchNextPage();
  }, [articles.hasNextPage, articles.isFetchingNextPage, articles.fetchNextPage]);

  const gridStyle = {
    "--sidebar-width": `${layout.sidebarCollapsed ? 52 : layout.sidebarWidth}px`,
    "--list-width": `${layout.listCollapsed ? 52 : layout.listWidth}px`,
  } as CSSProperties;

  return (
    <div className="app">
      <header className="header">
        {isNarrow && (
          <button className="icon-btn hamburger" aria-label="Toggle feeds" onClick={() => setDrawerOpen((v) => !v)}>☰</button>
        )}
        <h1 className="brand">Reader</h1>
        <span className="spacer" />
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
          selectedFeedId={feedId}
          selectedListId={listId}
          onSelectFeed={selectFeed}
          onSelectList={selectList}
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
        />
        <ColumnResizer className="list-resizer" label="Resize articles column" value={layout.listWidth} onResize={(delta) => resize("list", delta)} />
        <ArticleView
          article={selectedArticle}
          loading={Boolean(articleId && (articles.isLoading || deepArticle.isLoading) && !selectedArticle)}
          requested={articleId !== null}
          error={deepArticle.isError && !selectedArticle}
          prevArticle={prevArticle}
          nextArticle={nextArticle}
          onNavArticle={goArticle}
          navDir={navDir}
          onBack={isMobile ? () => navigate(listId ? listPath(listId, selectedListTitle(listId)) : feedPath(selectedArticle?.feedId ?? feedId, selectedFeedTitle(selectedArticle?.feedId ?? feedId))) : undefined}
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
      <ShortcutHints open={shortcutHelp} notice={shortcutNotice} onToggle={() => setShortcutHelp((open) => !open)} />
    </div>
  );
}
