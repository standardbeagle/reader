import { useEffect, useRef, useState, type TouchEvent } from "react";
import type { Article } from "./api";
import { safeUrl } from "./urls";

const SWIPE_OPEN_PX = 12;
const SWIPE_COMMIT_PX = 72;
const SWIPE_COMMIT_VELOCITY = 0.55;

export function ArticleView(props: {
  article: Article | null;
  prevArticle?: Article | null;
  nextArticle?: Article | null;
  onNavArticle?: (target: Article, dir: "prev" | "next") => void;
  navDir?: "prev" | "next" | null;
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

  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    panelRef.current?.scrollTo({ top: 0 });
  }, [a?.id]);

  // Horizontal swipe navigation (touch): lock to one axis after a small
  // threshold so vertical scrolling is never hijacked, drag the article with
  // the finger, commit past a distance or velocity, spring back otherwise.
  const [swipe, setSwipe] = useState<{ dx: number; engaged: boolean } | null>(null);
  const touch = useRef<{ startX: number; startY: number; lastX: number; lastT: number; axis: "h" | "v" | null } | null>(null);
  const canSwipe = Boolean(a && props.onNavArticle && view === "reader");

  const onTouchStart = (event: TouchEvent<HTMLElement>) => {
    if (!canSwipe || event.touches.length !== 1) return;
    const t = event.touches[0];
    if (!t) return;
    touch.current = { startX: t.clientX, startY: t.clientY, lastX: t.clientX, lastT: event.timeStamp, axis: null };
    setSwipe(null);
  };
  const onTouchMove = (event: TouchEvent<HTMLElement>) => {
    const state = touch.current;
    if (!state || event.touches.length !== 1) return;
    const t = event.touches[0];
    if (!t) return;
    const dx = t.clientX - state.startX;
    const dy = t.clientY - state.startY;
    if (!state.axis) {
      if (Math.abs(dx) > SWIPE_OPEN_PX && Math.abs(dx) > Math.abs(dy) * 1.5) state.axis = "h";
      else if (Math.abs(dy) > SWIPE_OPEN_PX) state.axis = "v";
      if (!state.axis) return;
    }
    if (state.axis === "v") return;
    state.lastX = t.clientX;
    state.lastT = event.timeStamp;
    // Resist dragging past the ends of the list.
    const resist = (dx > 0 && !props.prevArticle) || (dx < 0 && !props.nextArticle) ? 0.22 : 1;
    setSwipe({ dx: dx * resist, engaged: true });
  };
  const onTouchEnd = (event: TouchEvent<HTMLElement>) => {
    const state = touch.current;
    touch.current = null;
    const current = swipe;
    setSwipe(null);
    if (!state || state.axis !== "h" || !current?.engaged || !props.onNavArticle) return;
    const endX = event.changedTouches[0]?.clientX;
    if (endX === undefined) return;
    const dt = Math.max(1, event.timeStamp - state.lastT);
    const velocity = (endX - state.lastX) / dt;
    const commit = Math.abs(current.dx) > SWIPE_COMMIT_PX || Math.abs(velocity) > SWIPE_COMMIT_VELOCITY;
    if (!commit) return;
    if (current.dx < 0 && props.nextArticle) props.onNavArticle(props.nextArticle, "next");
    else if (current.dx > 0 && props.prevArticle) props.onNavArticle(props.prevArticle, "prev");
  };

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
  const enterClass = props.navDir === "next" ? " enter-next" : props.navDir === "prev" ? " enter-prev" : "";
  const swipeStyle = swipe?.engaged
    ? { transform: `translateX(${swipe.dx}px)`, transition: "none" }
    : undefined;
  const showNav = Boolean(props.onNavArticle && (props.prevArticle || props.nextArticle));
  return (
    <main
      id="reader-panel"
      ref={panelRef}
      className="reader"
      aria-label="Article reader"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={() => { touch.current = null; setSwipe(null); }}
    >
      <div key={a.id} className={`article${enterClass}`} style={swipeStyle}>
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
        {showNav && (
          <nav className="article-nav" aria-label="Article navigation">
            {props.prevArticle ? (
              <button className="nav-link nav-prev" onClick={() => props.onNavArticle!(props.prevArticle!, "prev")}>
                <span className="nav-arrow" aria-hidden="true">←</span>
                <span className="nav-target">
                  <span className="nav-dir">Previous</span>
                  <span className="nav-title">{props.prevArticle.title}</span>
                </span>
              </button>
            ) : <span className="nav-spacer" />}
            {props.nextArticle ? (
              <button className="nav-link nav-next" onClick={() => props.onNavArticle!(props.nextArticle!, "next")}>
                <span className="nav-target">
                  <span className="nav-dir">Next</span>
                  <span className="nav-title">{props.nextArticle.title}</span>
                </span>
                <span className="nav-arrow" aria-hidden="true">→</span>
              </button>
            ) : <span className="nav-spacer" />}
          </nav>
        )}
      </div>
    </main>
  );
}
