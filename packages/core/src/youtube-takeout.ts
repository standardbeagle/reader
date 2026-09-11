import type { FeedOutline } from "./opml.js";

const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

export function youtubeChannelFeedUrl(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
}

/** RFC 4180 rows: quoted fields, "" escapes, CRLF or LF line ends. */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (quoted) throw new Error("unterminated quote in CSV");
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * Map a Google Takeout `subscriptions.csv` (Channel Id, Channel Url, Channel
 * Title) to per-channel YouTube RSS feeds. Takeout localizes the header text,
 * so the header is recognised by its first cell not being a channel id rather
 * than by name. Any other row without a channel id fails the whole file — a
 * partial import would hide that the wrong file was picked.
 */
export function parseYoutubeTakeout(csv: string): FeedOutline[] {
  const rows = parseCsvRows(csv.replace(/^\uFEFF/, ""));
  const out: FeedOutline[] = [];
  const seen = new Set<string>();
  rows.forEach((cells, index) => {
    const id = cells[0]?.trim() ?? "";
    if (cells.every((c) => !c.trim())) return;
    if (!CHANNEL_ID.test(id)) {
      if (index === 0) return;
      throw new Error(`line ${index + 1}: not a YouTube channel id`);
    }
    if (seen.has(id)) return;
    seen.add(id);
    out.push({
      title: cells[2]?.trim() || id,
      xmlUrl: youtubeChannelFeedUrl(id),
      htmlUrl: `https://www.youtube.com/channel/${id}`,
    });
  });
  return out;
}
