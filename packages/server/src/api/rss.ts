import type { Article, SavedList } from "../storage/types.js";

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function cdata(value: string): string {
  return `<![CDATA[${value.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

/** RSS 2.0 rendering of a saved list. Article HTML is already sanitized at
 *  ingest time; it goes out in CDATA so feed readers get it verbatim. */
export function listFeedXml(list: SavedList, articles: Article[], selfUrl: string): string {
  const items = articles.map((a) => {
    const link = a.url ?? selfUrl;
    const pubDate = a.publishedAt ? `<pubDate>${new Date(a.publishedAt).toUTCString()}</pubDate>` : "";
    const body = a.contentHtml ?? (a.summary ? `<p>${xmlEscape(a.summary)}</p>` : "");
    return `    <item>
      <title>${xmlEscape(a.title)}</title>
      <link>${xmlEscape(link)}</link>
      <guid isPermaLink="false">${xmlEscape(a.id)}</guid>
      ${a.author ? `<author>${xmlEscape(a.author)}</author>` : ""}
      ${pubDate}
      <description>${cdata(body)}</description>
    </item>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${xmlEscape(list.title)}</title>
    <link>${xmlEscape(selfUrl)}</link>
    <description>${xmlEscape(`Articles saved to “${list.title}” in Reader`)}</description>
${items.join("\n")}
  </channel>
</rss>
`;
}
