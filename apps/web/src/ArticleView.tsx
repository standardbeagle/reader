import type { Article } from "./api";

function safeUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
}

export function ArticleView(props: { article: Article | null }) {
  const a = props.article;
  if (!a) return <main className="reader empty">Select an article</main>;
  const href = a.url ? safeUrl(a.url) : null;
  return (
    <main className="reader">
      <h2>{href ? <a href={href} target="_blank" rel="noopener noreferrer">{a.title}</a> : a.title}</h2>
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
