import { useEffect, useState, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useParams } from "react-router";
import { api, ApiError, type Article } from "./api";
import { Sidebar } from "./Sidebar";
import { ArticleList } from "./ArticleList";
import { ArticleView } from "./ArticleView";
import { ColumnResizer } from "./ColumnResizer";
import { ShortcutHints } from "./ShortcutHints";
import { useTheme, toggleTheme } from "./theme";
import { useMediaQuery } from "./useMediaQuery";
import { useColumnLayout } from "./useColumnLayout";
import { idFromRouteKey, routeKey, safeUrl } from "./urls";

function feedPath(feedId: string | null, feedTitle?: string | null): string {
  return feedId ? `/feeds/${routeKey(feedTitle ?? "feed", feedId)}` : "/";
}

function articlePath(article: Article, feedTitle?: string | null): string {
  return `/feeds/${routeKey(feedTitle ?? "feed", article.feedId)}/articles/${routeKey(article.title, article.id)}`;
}

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams<{ feedId?: string; articleId?: string }>();
  const feedId = params.feedId ? idFromRouteKey(params.feedId) : null;
  const articleId = params.articleId ? idFromRouteKey(params.articleId) : null;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [shortcutHelp, setShortcutHelp] = useState(false);
  const [shortcutNotice, setShortcutNotice] = useState<string | null>(null);
  const theme = useTheme();
  const isNarrow = useMediaQuery("(max-width: 1099px)");
  const isMobile = useMediaQuery("(max-width: 699px)");
  const { layout, resize, toggle } = useColumnLayout();
  const qc = useQueryClient();
  const feeds = useQuery({ queryKey: ["feeds"], queryFn: api.listFeeds, refetchInterval: 60_000 });

  const articles = useQuery({
    queryKey: ["articles", feedId],
    queryFn: () => api.listArticles(feedId ? { feedId } : {}),
    refetchInterval: 60_000,
  });
  const articleFromList = articles.data?.find((item) => item.id === articleId);
  const deepArticle = useQuery({
    queryKey: ["article", articleId],
    queryFn: () => api.getArticle(articleId!),
    enabled: Boolean(articleId),
    retry: false,
  });
  const article = deepArticle.data ?? null;
  const selectedArticle = article ?? articleFromList ?? null;
  const selectedFeedTitle = (id: string | null) => feeds.data?.find((feed) => feed.id === id)?.title ?? null;

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

  useEffect(() => {
    if (!shortcutNotice) return;
    const timer = window.setTimeout(() => setShortcutNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [shortcutNotice]);

  const selectFeed = (id: string | null) => { navigate(feedPath(id, selectedFeedTitle(id))); setDrawerOpen(false); };
  const selectArticle = (next: Article) => { navigate(articlePath(next, selectedFeedTitle(next.feedId))); setDrawerOpen(false); };
  const showReader = isMobile && (article !== null || articleId !== null);

  useEffect(() => {
    if (!feeds.data) return;
    if (article) {
      const canonical = articlePath(article, selectedFeedTitle(article.feedId));
      if (location.pathname !== canonical) navigate(canonical, { replace: true });
      return;
    }
    if (feedId && !articleId) {
      const canonical = feedPath(feedId, selectedFeedTitle(feedId));
      if (location.pathname !== canonical) navigate(canonical, { replace: true });
    }
  }, [article, articleId, feedId, feeds.data, location.pathname, navigate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || event.isComposing || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")) return;
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
      const list = articles.data ?? [];
      if (event.key === "j" || event.key === "k") {
        event.preventDefault();
        const current = selectedArticle ? list.findIndex((item) => item.id === selectedArticle.id) : -1;
        const nextIndex = event.key === "j"
          ? Math.min(list.length - 1, current + 1)
          : Math.max(0, current < 0 ? 0 : current - 1);
        const next = list[nextIndex];
        if (next) navigate(articlePath(next, selectedFeedTitle(next.feedId)));
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
  }, [articles.data, feedId, feeds.data, navigate, refresh, selectedArticle, shortcutHelp, toggle]);

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
        <button className="icon-btn" aria-label="Toggle theme" onClick={toggleTheme}>
          {theme === "dark" ? "☀" : "☾"}
        </button>
      </header>
      <div className={`layout${showReader ? " show-reader" : ""}${layout.readerCollapsed ? " reader-collapsed" : ""}`} style={gridStyle}>
        <Sidebar
          selectedFeedId={feedId}
          onSelectFeed={selectFeed}
          open={!isNarrow || drawerOpen}
          drawer={isNarrow}
          onCloseDrawer={() => setDrawerOpen(false)}
          collapsed={layout.sidebarCollapsed}
          onToggleCollapsed={() => toggle("sidebar")}
          onRefreshFeed={(id) => refresh.mutate(id)}
          refreshingFeedId={refresh.isPending ? (refresh.variables ?? null) : null}
        />
        <ColumnResizer className="sidebar-resizer" label="Resize feeds column" value={layout.sidebarWidth} onResize={(delta) => resize("sidebar", delta)} />
        <ArticleList
          articles={articles.data ?? []}
          loading={articles.isLoading}
          selectedId={articleId ?? article?.id ?? null}
          onSelect={selectArticle}
          collapsed={layout.listCollapsed}
          onToggleCollapsed={() => toggle("list")}
        />
        <ColumnResizer className="list-resizer" label="Resize articles column" value={layout.listWidth} onResize={(delta) => resize("list", delta)} />
        <ArticleView
          article={article}
          loading={Boolean(articleId && (articles.isLoading || deepArticle.isLoading))}
          requested={articleId !== null}
          onBack={isMobile ? () => navigate(feedPath(article?.feedId ?? articleFromList?.feedId ?? feedId, selectedFeedTitle(article?.feedId ?? articleFromList?.feedId ?? feedId))) : undefined}
          collapsed={layout.readerCollapsed}
          onToggleCollapsed={() => toggle("reader")}
        />
      </div>
      <ShortcutHints open={shortcutHelp} notice={shortcutNotice} onToggle={() => setShortcutHelp((open) => !open)} />
    </div>
  );
}
