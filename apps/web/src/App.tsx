import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Article } from "./api";
import { Sidebar } from "./Sidebar";
import { ArticleList } from "./ArticleList";
import { ArticleView } from "./ArticleView";

export function App() {
  const [feedId, setFeedId] = useState<string | null>(null);
  const [article, setArticle] = useState<Article | null>(null);

  const articles = useQuery({
    queryKey: ["articles", feedId],
    queryFn: () => api.listArticles(feedId ? { feedId } : {}),
  });

  return (
    <div className="layout">
      <Sidebar selectedFeedId={feedId} onSelectFeed={(id) => { setFeedId(id); setArticle(null); }} />
      <ArticleList
        articles={articles.data ?? []}
        loading={articles.isLoading}
        selectedId={article?.id ?? null}
        onSelect={setArticle}
      />
      <ArticleView article={article} />
    </div>
  );
}
