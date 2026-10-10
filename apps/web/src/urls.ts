export function safeUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96)
    .replace(/-+$/g, "");
  return slug || "item";
}

/** A readable key with the stable id retained for exact client-side routing. */
export function routeKey(label: string, id: string): string {
  return `${slugify(label)}--${id}`;
}

export function idFromRouteKey(value: string): string {
  const marker = value.lastIndexOf("--");
  return marker >= 0 ? value.slice(marker + 2) : value;
}

const EMBEDDED_PAGE_SANDBOX = "allow-forms allow-modals allow-popups allow-presentation allow-scripts";

/**
 * The sandbox for an article's original page. The page keeps its own origin:
 * without it the frame has none, the browser refuses the page's module
 * scripts (they are fetched under CORS, which a site does not grant itself)
 * and its storage, and anything built from them, such as Astro islands,
 * never starts. A page on Reader's own origin is the exception: scripts that
 * shared this origin could reach Reader and its API, so it stays without one.
 */
export function embeddedPageSandbox(pageUrl: string, ownOrigin = window.location.origin): string {
  return new URL(pageUrl).origin === ownOrigin ? EMBEDDED_PAGE_SANDBOX : `allow-same-origin ${EMBEDDED_PAGE_SANDBOX}`;
}
