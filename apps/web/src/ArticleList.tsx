import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Article } from "./api";

export function ArticleList(props: {
  articles: Article[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (a: Article) => void;
}) {
  const qc = useQueryClient();
  const setRead = useMutation({
    mutationFn: ({ id, read }: { id: string; read: boolean }) => api.setRead(id, read),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["articles"] });
      qc.invalidateQueries({ queryKey: ["feeds"] });
    },
  });

  if (props.loading) {
    return (
      <section className="list" role="region" aria-label="Article list">
        <div className="skel">
          {[0, 1, 2, 3, 4, 5].map((i) => <div className="bar" key={i} />)}
        </div>
      </section>
    );
  }
  if (props.articles.length === 0) {
    return (
      <section className="list" role="region" aria-label="Article list">
        <div className="empty">No articles.</div>
      </section>
    );
  }

  return (
    <section className="list" role="region" aria-label="Article list">
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
