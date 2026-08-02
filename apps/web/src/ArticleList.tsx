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

  if (props.loading) return <section className="list">Loading…</section>;
  if (props.articles.length === 0) return <section className="list">No articles.</section>;

  return (
    <section className="list">
      <ul>
        {props.articles.map((a) => (
          <li key={a.id} className={`${a.readAt ? "read" : "unread"} ${props.selectedId === a.id ? "selected" : ""}`}>
            <button
              onClick={() => {
                props.onSelect(a);
                if (!a.readAt) setRead.mutate({ id: a.id, read: true });
              }}
            >
              {a.title}
            </button>
            <span className="date">{a.publishedAt ? new Date(a.publishedAt).toLocaleDateString() : ""}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
