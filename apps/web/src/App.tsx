import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Article } from "./api";
import { Sidebar } from "./Sidebar";
import { ArticleList } from "./ArticleList";
import { ArticleView } from "./ArticleView";
import { useTheme, toggleTheme } from "./theme";
import { useMediaQuery } from "./useMediaQuery";

export function App() {
  const [feedId, setFeedId] = useState<string | null>(null);
  const [article, setArticle] = useState<Article | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const theme = useTheme();
  const isNarrow = useMediaQuery("(max-width: 1099px)");
  const isMobile = useMediaQuery("(max-width: 699px)");

  const articles = useQuery({
    queryKey: ["articles", feedId],
    queryFn: () => api.listArticles(feedId ? { feedId } : {}),
  });

  const selectFeed = (id: string | null) => { setFeedId(id); setArticle(null); setDrawerOpen(false); };
  const showReader = isMobile && article !== null;

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
      <div className={`layout${showReader ? " show-reader" : ""}`}>
        <Sidebar
          selectedFeedId={feedId}
          onSelectFeed={selectFeed}
          open={!isNarrow || drawerOpen}
          drawer={isNarrow}
          onCloseDrawer={() => setDrawerOpen(false)}
        />
        <ArticleList
          articles={articles.data ?? []}
          loading={articles.isLoading}
          selectedId={article?.id ?? null}
          onSelect={setArticle}
        />
        <ArticleView article={article} onBack={isMobile ? () => setArticle(null) : undefined} />
      </div>
    </div>
  );
}
