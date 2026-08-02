import Parser from "rss-parser";
import { createHash } from "node:crypto";
import type { ParsedFeed, ParsedArticle } from "./types.js";

const parser = new Parser();

export async function parseFeed(xml: string): Promise<ParsedFeed> {
  const raw = await parser.parseString(xml);
  const articles: ParsedArticle[] = (raw.items ?? []).map((item) => {
    const it = item as Parser.Item & { id?: string; author?: string; "content:encoded"?: string };
    const title = it.title?.trim() || "(untitled)";
    const url = it.link ?? null;
    const published = it.isoDate ?? it.pubDate ?? null;
    const parsedDate = published ? new Date(published) : null;
    const explicitGuid = it.guid ?? it.id ?? null;
    const guid = explicitGuid
      ?? `sha1:${createHash("sha1").update(url ?? `${title}|${published ?? ""}`).digest("hex")}`;
    return {
      guid,
      url,
      title,
      author: it.creator ?? it.author ?? null,
      publishedAt: parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate : null,
      contentHtml: (it["content:encoded"] as string | undefined) ?? it.content ?? null,
      summary: it.summary ?? it.contentSnippet ?? null,
    };
  });
  return {
    title: raw.title?.trim() || "(untitled feed)",
    siteUrl: raw.link ?? null,
    articles,
  };
}
