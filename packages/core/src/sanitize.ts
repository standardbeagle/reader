import { JSDOM } from "jsdom";
import createDOMPurify from "dompurify";

const window = new JSDOM("").window;
const DOMPurify = createDOMPurify(window as unknown as Parameters<typeof createDOMPurify>[0]);
let activeBaseUrl: string | undefined;

const URL_ATTRIBUTES = ["href", "src", "poster", "cite"] as const;

function normalizeKnownEmbeds(dirty: string): string {
  const document = new JSDOM(`<body>${dirty}</body>`).window.document;
  for (const node of Array.from(document.querySelectorAll("lite-youtube"))) {
    const videoId = node.getAttribute("videoid")?.trim() ?? "";
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(videoId)) {
      node.remove();
      continue;
    }
    const iframe = document.createElement("iframe");
    iframe.setAttribute("src", `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`);
    iframe.setAttribute("title", node.getAttribute("title")?.trim() || "Embedded YouTube video");
    iframe.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share");
    iframe.setAttribute("allowfullscreen", "");
    node.replaceWith(iframe);
  }
  return document.body.innerHTML;
}

function safeResolvedUrl(raw: string, baseUrl?: string, allowMailto = false): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.startsWith("#")) return value;
  if (/^https?:\/\//i.test(value)) return value;
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
    if (allowMailto && (url.protocol === "mailto:" || url.protocol === "tel:")) return url.href;
    return null;
  } catch {
    return null;
  }
}

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  const tag = node.tagName.toLowerCase();
  const baseUrl = activeBaseUrl;

  for (const attr of URL_ATTRIBUTES) {
    const raw = node.getAttribute(attr);
    if (!raw) continue;
    const resolved = safeResolvedUrl(raw, baseUrl, tag === "a" && attr === "href");
    if (resolved) node.setAttribute(attr, resolved);
    else node.removeAttribute(attr);
  }

  const rawSrcset = node.getAttribute("srcset");
  if (rawSrcset) {
    const srcset = rawSrcset.split(",").flatMap((candidate) => {
      const parts = candidate.trim().split(/\s+/);
      const resolved = parts.shift();
      if (!resolved) return [];
      const safe = safeResolvedUrl(resolved, baseUrl);
      return safe ? [`${safe}${parts.length ? ` ${parts.join(" ")}` : ""}`] : [];
    });
    if (srcset.length > 0) node.setAttribute("srcset", srcset.join(", "));
    else node.removeAttribute("srcset");
  }

  if (tag === "a") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
  if (tag === "img") {
    node.setAttribute("loading", "lazy");
    node.setAttribute("referrerpolicy", "no-referrer");
    node.setAttribute("decoding", "async");
  }
  if (tag === "audio" || tag === "video") {
    node.setAttribute("controls", "");
    node.setAttribute("preload", "metadata");
    if (tag === "video") node.setAttribute("playsinline", "");
  }
  if (tag === "iframe") {
    if (!node.getAttribute("src")) {
      node.remove();
      return;
    }
    node.setAttribute("loading", "lazy");
    const src = node.getAttribute("src") ?? "";
    const isYouTubeEmbed = /^https:\/\/www\.youtube-nocookie\.com\/embed\//i.test(src);
    // YouTube error 153 is returned when the embed request has no HTTP
    // Referer. Preserve only the embedding origin for YouTube; other third-
    // party frames keep the stricter no-referrer policy.
    node.setAttribute("referrerpolicy", isYouTubeEmbed ? "strict-origin-when-cross-origin" : "no-referrer");
    node.setAttribute(
      "sandbox",
      `${isYouTubeEmbed ? "allow-same-origin " : ""}allow-forms allow-modals allow-popups allow-presentation allow-scripts`,
    );
  }
});

export function sanitizeHtml(dirty: string, baseUrl?: string): string {
  activeBaseUrl = baseUrl;
  try {
    return DOMPurify.sanitize(normalizeKnownEmbeds(dirty), {
    ALLOWED_TAGS: [
      "a", "abbr", "audio", "b", "blockquote", "br", "code", "dd", "del", "div", "dl",
      "dt", "em", "figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6",
      "hr", "i", "img", "iframe", "li", "maction", "math", "merror", "mfrac", "mfenced", "mi", "mmultiscripts",
      "mn", "mo", "mover", "mpadded", "mroot", "mrow", "ms", "mspace", "msqrt", "mstyle",
      "msub", "msubsup", "msup", "mtable", "mtd", "mtext", "mtr", "munder", "munderover",
      "mphantom", "none", "ol", "p", "picture", "pre", "q", "s", "semantics", "small", "source", "span",
      "strong", "sub", "sup", "table", "tbody", "td", "th", "thead", "track", "tr", "u", "ul",
      "video",
    ],
    ALLOWED_ATTR: [
      "alt", "allow", "allowfullscreen", "class", "cite", "colspan", "controls", "datetime",
      "decoding", "height", "href", "kind", "label", "loading", "poster", "preload", "referrerpolicy",
      "rel", "rowspan", "sandbox", "scope", "src", "srcset", "srclang", "style", "target", "title",
      "type", "width", "xmlns", "mathvariant", "display", "stretchy", "fence", "separator", "accent",
      "accentunder", "form", "bevelled", "linethickness", "numalign", "denomalign", "rowalign",
      "columnalign", "columnspacing", "rowspacing", "encoding",
    ],
    FORBID_TAGS: ["form", "object", "script", "style", "svg"],
    ALLOW_DATA_ATTR: false,
    });
  } finally {
    activeBaseUrl = undefined;
  }
}
