/** A linked file: an episode's audio/video, or its transcript. */
export interface ArticleMedia {
  url: string;
  type: string | null;
}

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
  /** Playable audio or video (a podcast enclosure). */
  media?: ArticleMedia | null;
  /** Podcasting 2.0 <podcast:transcript>, the most readable format offered. */
  transcript?: ArticleMedia | null;
  /** Podcasting 2.0 <podcast:chapters> JSON. */
  chaptersUrl?: string | null;
}

export interface ParsedFeed {
  title: string;
  siteUrl: string | null;
  articles: ParsedArticle[];
  /** The publisher's own minimum refresh interval (RSS <ttl>, sy:updatePeriod/Frequency), in minutes. */
  updateHintMinutes?: number | null;
}
