import type { Article } from "./api";

export function ArticleView(props: { article: Article | null }) {
  const a = props.article;
  if (!a) return <main className="reader empty">Select an article</main>;
  return (
    <main className="reader">
      <h2>{a.url ? <a href={a.url} target="_blank" rel="noopener noreferrer">{a.title}</a> : a.title}</h2>
      <p className="meta">
        {a.author && <span>{a.author} · </span>}
        {a.publishedAt && new Date(a.publishedAt).toLocaleString()}
      </p>
      {a.contentHtml
        ? <article dangerouslySetInnerHTML={{ __html: a.contentHtml }} />
        : <p>{a.summary ?? "(no content)"}</p>}
    </main>
  );
}
