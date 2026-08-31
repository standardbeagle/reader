export interface ParsedArticle {
  guid: string;
  url: string | null;
  title: string;
  author: string | null;
  publishedAt: Date | null;
  contentHtml: string | null;
  summary: string | null;
  imageUrl?: string | null;
  /** Subject tags from the feed (RSS <category> / Atom <category term>). */
  categories?: string[];
}

export interface ParsedFeed {
  title: string;
  siteUrl: string | null;
  articles: ParsedArticle[];
}
