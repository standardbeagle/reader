import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Article } from "./api";
import { safeUrl } from "./urls";

const SWIPE_OPEN_PX = 12;
const SWIPE_COMMIT_PX = 64;
const SWIPE_COMMIT_VELOCITY = 0.5;
const LEAVE_MS = 620;

type NavDir = "prev" | "next" | null;
type Stage = { a: Article; dir: NavDir };

export function ArticleView(props: {
  article: Article | null;
  prevArticle?: Article | null;
  nextArticle?: Article | null;
  onNavArticle?: (target: Article, dir: "prev" | "next") => void;
  navDir?: NavDir;
  onBack?: (() => void) | undefined;
  loading?: boolean;
  requested?: boolean;
  error?: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  // Two-layer push transition: when the article changes, the outgoing one
  // stays mounted as an absolutely-positioned snapshot that animates out
  // while the incoming one animates in. Derived during render so the
  // transition starts in the same commit as the article change.
  const [stage, setStage] = useState<Stage | null>(props.article ? { a: props.article, dir: null } : null);
  const [leaving, setLeaving] = useState<Stage | null>(null);
  const next = props.article;
  if (!next) {
    if (stage) setStage(null);
    if (leaving) setLeaving(null);
  } else if (!stage || next.id !== stage.a.id) {
    setLeaving(stage ? { a: stage.a, dir: props.navDir ?? null } : null);
    setStage({ a: next, dir: props.navDir ?? null });
  } else if (stage.a !== next) {
    setStage({ a: next, dir: stage.dir });
  }
  const [view, setView] = useState<"reader" | "embedded">("reader");

  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => setLeaving(null), LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  useEffect(() => setView("reader"), [stage?.a.id]);

  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    panelRef.current?.scrollTo({ top: 0 });
  }, [stage?.a.id]);

  // Horizontal swipe navigation (pointer events): lock to one axis after a
  // small threshold so vertical scrolling is never hijacked, drag the article
  // with the finger via pointer capture, commit past a distance or velocity.
  // pointercancel (the browser claiming the gesture) still commits when the
  // drag was already clearly horizontal and past threshold — iOS Safari fires
  // cancel aggressively, and dropping the gesture there reads as "swipe does
  // nothing".
  const [swipe, setSwipe] = useState<{ dx: number; active: boolean } | null>(null);
  const drag = useRef<{ pointerId: number; startX: number; startY: number; lastX: number; lastT: number; axis: "h" | "v" | null } | null>(null);
  const a = stage?.a ?? null;
  const canSwipe = Boolean(a && props.onNavArticle && view === "reader" && !leaving);

  const swipeDx = (dx: number) => {
    const resist = (dx > 0 && !props.prevArticle) || (dx < 0 && !props.nextArticle) ? 0.22 : 1;
    return dx * resist;
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!canSwipe || event.pointerType === "mouse" || !event.isPrimary) return;
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastT: event.timeStamp, axis: null };
    setSwipe(null);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state || event.pointerId !== state.pointerId) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (!state.axis) {
      if (Math.abs(dx) > SWIPE_OPEN_PX && Math.abs(dx) > Math.abs(dy) * 1.2) {
        state.axis = "h";
        try { panelRef.current?.setPointerCapture(event.pointerId); } catch { /* pointer already gone */ }
      } else if (Math.abs(dy) > SWIPE_OPEN_PX) {
        state.axis = "v";
      }
      if (!state.axis) return;
    }
    if (state.axis === "v") return;
    state.lastX = event.clientX;
    state.lastT = event.timeStamp;
    setSwipe({ dx: swipeDx(dx), active: true });
  };
  const commitSwipe = (state: NonNullable<typeof drag.current>, endX: number, timeStamp: number) => {
    const dx = endX - state.startX;
    const dt = Math.max(1, timeStamp - state.lastT);
    const velocity = (endX - state.lastX) / dt;
    if (Math.abs(dx) < SWIPE_COMMIT_PX && Math.abs(velocity) < SWIPE_COMMIT_VELOCITY) return;
    const target = dx < 0 ? props.nextArticle : dx > 0 ? props.prevArticle : null;
    const dir = dx < 0 ? "next" : "prev";
    if (target && props.onNavArticle) props.onNavArticle(target, dir);
  };
  const endDrag = (event: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
    const state = drag.current;
    drag.current = null;
    setSwipe(null);
    if (state) { try { panelRef.current?.releasePointerCapture(state.pointerId); } catch { /* not captured */ } }
    if (!state || event.pointerId !== state.pointerId || state.axis !== "h" || !props.onNavArticle) return;
    const endX = event.clientX;
    if (cancelled) {
      // Only salvage clearly-committed horizontal drags; anything ambiguous
      // was probably vertical scrolling that the browser took over.
      if (Math.abs(endX - state.startX) > SWIPE_COMMIT_PX * 1.25) commitSwipe(state, endX, event.timeStamp);
      return;
    }
    commitSwipe(state, endX, event.timeStamp);
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
  const swipeStyle = swipe?.active ? { transform: `translateX(${swipe.dx}px)`, transition: "none" } : undefined;
  const enterClass = stage?.dir === "next" ? " enter-next" : stage?.dir === "prev" ? " enter-prev" : "";
  const showNav = Boolean(props.onNavArticle && (props.prevArticle || props.nextArticle));
  return (
    <main
      id="reader-panel"
      ref={panelRef}
      className="reader"
      aria-label="Article reader"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => endDrag(event, false)}
      onPointerCancel={(event) => endDrag(event, true)}
    >
      <div className="reader-stage">
        {leaving && (
          <div key={`out-${leaving.a.id}`} className={`article article-leaving${leaving.dir ? ` leave-${leaving.dir}` : ""}`} aria-hidden="true">
            <ArticleSnapshot a={leaving.a} />
          </div>
        )}
        <div key={a.id} className={`article${enterClass}`} style={swipeStyle}>
          {props.onBack && <button className="back-btn" onClick={props.onBack}>← Back to list</button>}
          <div className="article-heading">
            <div>
              <Heading a={a} />
              <p className="meta">
                {a.author && <span>{a.author} · </span>}
                {a.publishedAt && new Date(a.publishedAt).toLocaleString()}
              </p>
            </div>
            <button className="panel-collapse" onClick={props.onToggleCollapsed} aria-expanded={true} aria-controls="reader-panel">Collapse reader</button>
          </div>
          <ReaderBody a={a} view={view} setView={setView} showTabs={Boolean(safeUrl(a.url))} />
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
      </div>
    </main>
  );
}

function Heading({ a }: { a: Article }) {
  const href = safeUrl(a.url);
  return <h2>{href ? <a href={href} target="_blank" rel="noopener noreferrer">{a.title}</a> : a.title}</h2>;
}

function LeadMedia({ a, htmlBody }: { a: Article; htmlBody: string | null }) {
  const imageHref = safeUrl(a.imageUrl ?? null);
  const hasLeadImageInBody = Boolean(imageHref && htmlBody?.includes(imageHref));
  if (!imageHref || (htmlBody ? hasLeadImageInBody : false)) return null;
  return (
    <figure className="article-lead-media">
      <img src={imageHref} alt="" loading="lazy" referrerPolicy="no-referrer" />
    </figure>
  );
}

function ArticleSnapshot({ a }: { a: Article }) {
  const htmlBody = a.contentHtml?.trim() || null;
  const textBody = htmlBody ? null : a.summary?.trim() || null;
  return (
    <>
      <div className="article-heading">
        <div>
          <Heading a={a} />
          <p className="meta">
            {a.author && <span>{a.author} · </span>}
            {a.publishedAt && new Date(a.publishedAt).toLocaleString()}
          </p>
        </div>
      </div>
      <div className="leaving-body">
        <ArticleContent a={a} htmlBody={htmlBody} textBody={textBody} />
      </div>
    </>
  );
}

function ReaderBody(props: {
  a: Article;
  view: "reader" | "embedded";
  setView: (v: "reader" | "embedded") => void;
  showTabs: boolean;
}) {
  const a = props.a;
  const href = safeUrl(a.url);
  // contentHtml is sanitized server-side; summary is only ever plain text (the
  // server promotes any HTML-looking summary into contentHtml). Render each in
  // its own lane so raw feed bytes can never reach dangerouslySetInnerHTML.
  const htmlBody = a.contentHtml?.trim() || null;
  const textBody = htmlBody ? null : a.summary?.trim() || null;
  return (
    <>
      {props.showTabs && (
        <div className="reader-tabs" role="tablist" aria-label="Article views">
          <button
            id="reader-tab"
            className="reader-tab"
            type="button"
            role="tab"
            aria-selected={props.view === "reader"}
            aria-controls="reader-content-panel"
            onClick={() => props.setView("reader")}
          >Reader</button>
          <button
            id="embedded-tab"
            className="reader-tab"
            type="button"
            role="tab"
            aria-selected={props.view === "embedded"}
            aria-controls="embedded-content-panel"
            onClick={() => props.setView("embedded")}
          >Embedded page</button>
        </div>
      )}
      {props.view === "embedded" && href ? (
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
          <ArticleContent a={a} htmlBody={htmlBody} textBody={textBody} />
        </div>
      )}
    </>
  );
}

function ArticleContent({ a, htmlBody, textBody }: { a: Article; htmlBody: string | null; textBody: string | null }) {
  return (
    <>
      {htmlBody
        ? <>
            <LeadMedia a={a} htmlBody={htmlBody} />
            <article className="article-content" dangerouslySetInnerHTML={{ __html: htmlBody }} />
          </>
        : textBody
          ? <>
              <LeadMedia a={a} htmlBody={null} />
              <article className="article-content article-content-plain"><p className="feed-plain-text">{textBody}</p></article>
            </>
        : (
          <div className="content-fallback">
            <p>This feed did not include article content.</p>
            {safeUrl(a.url) && <p className="content-note">The publisher only supplied a summary. You can use the Embedded page tab to view the original.</p>}
          </div>
        )}
    </>
  );
}
