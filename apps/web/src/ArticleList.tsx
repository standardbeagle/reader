import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Article } from "./api";

export function ArticleList(props: {
  articles: Article[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (a: Article) => void;
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

  if (props.collapsed) {
    return (
      <section id="article-list-panel" className="list collapsed" role="region" aria-label="Article list">
        <button className="panel-rail" onClick={props.onToggleCollapsed} aria-label="Expand article list column" aria-expanded={false} aria-controls="article-list-panel">
          <span aria-hidden="true">›</span><span className="rail-label">Articles</span>
        </button>
      </section>
    );
  }

  if (props.loading) {
    return (
      <section id="article-list-panel" className="list" role="region" aria-label="Article list" aria-busy="true">
        <div className="panel-head">
          <h2>Articles</h2>
          <button className="panel-collapse" onClick={props.onToggleCollapsed} aria-expanded={true} aria-controls="article-list-panel">Collapse</button>
        </div>
        <div className="skel">
          {[0, 1, 2, 3, 4, 5].map((i) => <div className="bar" key={i} />)}
        </div>
      </section>
    );
  }
  if (props.articles.length === 0) {
    return (
      <section id="article-list-panel" className="list" role="region" aria-label="Article list">
        <div className="panel-head">
          <h2>Articles</h2>
          <button className="panel-collapse" onClick={props.onToggleCollapsed} aria-expanded={true} aria-controls="article-list-panel">Collapse</button>
        </div>
        <div className="empty">No articles.</div>
      </section>
    );
  }

  return (
    <section id="article-list-panel" className="list" role="region" aria-label="Article list">
      <div className="panel-head">
        <h2>Articles</h2>
        <button className="panel-collapse" onClick={props.onToggleCollapsed} aria-expanded={true} aria-controls="article-list-panel">Collapse</button>
      </div>
      <ul>
        {props.articles.map((a, index) => (
          <li
            key={a.id}
            className={`${a.readAt ? "read" : "unread"} ${props.selectedId === a.id ? "selected" : ""}`}
            style={{ animationDelay: `${Math.min(index, 12) * 12}ms` }}
          >
            <button
              onClick={() => {
                props.onSelect(a);
                if (!a.readAt) setRead.mutate({ id: a.id, read: true });
              }}
            >
              <span className="t">{a.title}</span>
            </button>
            <span className="date">{a.publishedAt ? new Date(a.publishedAt).toLocaleDateString() : ""}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
