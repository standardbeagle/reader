import { useEffect, useState } from "react";
import type { Article } from "./api";
import { safeUrl } from "./urls";

export function ArticleView(props: {
  article: Article | null;
  onBack?: (() => void) | undefined;
  loading?: boolean;
  requested?: boolean;
  error?: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const a = props.article;
  const [view, setView] = useState<"reader" | "embedded">("reader");
  useEffect(() => setView("reader"), [a?.id]);

  if (props.collapsed) {
    return (
      <main id="reader-panel" className="reader collapsed" aria-label="Reader column">
        <button className="panel-rail" onClick={props.onToggleCollapsed} aria-label="Expand reader column" aria-expanded={false} aria-controls="reader-panel">
          <span aria-hidden="true">‹</span><span className="rail-label">Reader</span>
        </button>
      </main>
    );
  }
  if (!a) {
    return (
      <main id="reader-panel" className="reader empty" aria-label="Reader column">
        <div className="empty-reader">
          <span>{props.loading ? "Loading article…" : props.error ? "Couldn't load this article." : props.requested ? "Article not found" : "Select an article"}</span>
          <button className="panel-collapse" onClick={props.onToggleCollapsed} aria-expanded={true} aria-controls="reader-panel">Collapse reader</button>
        </div>
      </main>
    );
  }
  const href = safeUrl(a.url);
  const imageHref = safeUrl(a.imageUrl ?? null);
  // contentHtml is sanitized server-side; summary is only ever plain text (the
  // server promotes any HTML-looking summary into contentHtml). Render each in
  // its own lane so raw feed bytes can never reach dangerouslySetInnerHTML.
  const htmlBody = a.contentHtml?.trim() || null;
  const textBody = htmlBody ? null : a.summary?.trim() || null;
  const hasLeadImageInBody = Boolean(imageHref && htmlBody?.includes(imageHref));
  return (
    <main id="reader-panel" className="reader" aria-label="Article reader">
      <div className="article">
        {props.onBack && <button className="back-btn" onClick={props.onBack}>← Back to list</button>}
        <div className="article-heading">
          <div>
            <h2>{href ? <a href={href} target="_blank" rel="noopener noreferrer">{a.title}</a> : a.title}</h2>
            <p className="meta">
              {a.author && <span>{a.author} · </span>}
              {a.publishedAt && new Date(a.publishedAt).toLocaleString()}
            </p>
          </div>
          <button className="panel-collapse" onClick={props.onToggleCollapsed} aria-expanded={true} aria-controls="reader-panel">Collapse reader</button>
        </div>
        {href && (
          <div className="reader-tabs" role="tablist" aria-label="Article views">
            <button
              id="reader-tab"
              className="reader-tab"
              type="button"
              role="tab"
              aria-selected={view === "reader"}
              aria-controls="reader-content-panel"
              onClick={() => setView("reader")}
            >Reader</button>
            <button
              id="embedded-tab"
              className="reader-tab"
              type="button"
              role="tab"
              aria-selected={view === "embedded"}
              aria-controls="embedded-content-panel"
              onClick={() => setView("embedded")}
            >Embedded page</button>
          </div>
        )}
        {view === "embedded" && href ? (
          <section id="embedded-content-panel" className="embedded-content-panel" role="tabpanel" aria-labelledby="embedded-tab">
            <iframe
              className="source-frame"
              src={href}
              title={`Original page: ${a.title}`}
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              sandbox="allow-forms allow-modals allow-popups allow-presentation allow-scripts"
              allow="fullscreen; picture-in-picture"
            />
            <p className="embedded-content-actions"><a href={href} target="_blank" rel="noopener noreferrer">Open original in a new tab ↗</a></p>
          </section>
        ) : (
          <div id="reader-content-panel" role={href ? "tabpanel" : undefined} aria-labelledby={href ? "reader-tab" : undefined}>
            {htmlBody
              ? <>
                  {imageHref && !hasLeadImageInBody && (
                    <figure className="article-lead-media">
                      <img src={imageHref} alt="" loading="lazy" referrerPolicy="no-referrer" />
                    </figure>
                  )}
                  <article className="article-content" dangerouslySetInnerHTML={{ __html: htmlBody }} />
                </>
              : textBody
                ? <>
                    {imageHref && (
                      <figure className="article-lead-media">
                        <img src={imageHref} alt="" loading="lazy" referrerPolicy="no-referrer" />
                      </figure>
                    )}
                    <article className="article-content article-content-plain"><p className="feed-plain-text">{textBody}</p></article>
                  </>
              : (
                <div className="content-fallback">
                  <p>This feed did not include article content.</p>
                  {href && <p className="content-note">The publisher only supplied a summary. You can use the Embedded page tab to view the original.</p>}
                </div>
              )}
          </div>
        )}
      </div>
    </main>
  );
}
