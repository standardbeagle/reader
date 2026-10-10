import { parseStringPromise } from "xml2js";

export interface FeedOutline {
  title: string;
  xmlUrl: string;
  htmlUrl: string | null;
  /** The folder the feed sat in (its nearest enclosing outline), if any. */
  category: string | null;
}

/**
 * Extract feed subscriptions from an OPML document. Outlines nest inside
 * folders, so the body is walked recursively; only outlines with an xmlUrl
 * (actual feeds, not folder headers) are collected. Duplicated xmlUrls are
 * collapsed — readers export duplicates surprisingly often.
 */
export function parseOpml(xml: string): Promise<FeedOutline[]> {
  return parseStringPromise(xml).then((doc) => {
    const body = doc?.opml?.body?.[0];
    if (!body) throw new Error("not an OPML document");
    const out: FeedOutline[] = [];
    const seen = new Set<string>();
    const walk = (outlines: unknown, folder: string | null): void => {
      if (!Array.isArray(outlines)) return;
      for (const node of outlines) {
        if (!node || typeof node !== "object") continue;
        const attrs = (node as Record<string, unknown>).$ as Record<string, unknown> | undefined;
        const xmlUrl = String(attrs?.xmlUrl ?? attrs?.xmlurl ?? "").trim();
        if (xmlUrl && !seen.has(xmlUrl)) {
          seen.add(xmlUrl);
          const title = String(attrs?.title ?? attrs?.text ?? xmlUrl).trim() || xmlUrl;
          const htmlUrl = String(attrs?.htmlUrl ?? attrs?.htmlurl ?? "").trim() || null;
          out.push({ title, xmlUrl, htmlUrl, category: folder });
        }
        // A feed outline can nest children too; only a pure folder names a category.
        const name = String(attrs?.title ?? attrs?.text ?? "").trim();
        walk((node as Record<string, unknown>).outline, xmlUrl ? folder : name || folder);
      }
    };
    walk(body.outline, null);
    return out;
  });
}
