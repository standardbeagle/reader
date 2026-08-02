import type { ParsedArticle } from "@reader/core";

export interface User { id: string; email: string | null; createdAt: string; }

export interface Feed {
  id: string;
  userId: string;
  url: string;
  title: string;
  siteUrl: string | null;
  etag: string | null;
  lastModified: string | null;
  lastFetchedAt: string | null;
  fetchIntervalMin: number;
  errorCount: number;
  status: "ok" | "broken";
  createdAt: string;
}

export interface Article {
  id: string;
  feedId: string;
  guid: string;
  url: string | null;
  title: string;
  author: string | null;
  publishedAt: string | null;
  contentHtml: string | null;
  summary: string | null;
  fetchedAt: string;
}

export interface ArticleWithState extends Article {
  readAt: string | null;
}

export interface ArticleQuery {
  userId: string;
  feedId?: string;
  unreadOnly?: boolean;
  before?: string; // ISO date cursor on published_at
  limit: number;
}

export interface FetchState {
  etag?: string | null;
  lastModified?: string | null;
  lastFetchedAt: string;
  fetchIntervalMin: number;
  errorCount: number;
  status: "ok" | "broken";
  title?: string;
  siteUrl?: string | null;
}

export interface Storage {
  close(): void | Promise<void>;
  getOrCreateLocalUser(): User;
  createFeed(userId: string, input: { url: string; title: string; siteUrl: string | null }): Feed;
  listFeeds(userId: string): Feed[];
  getFeed(id: string): Feed | null;
  deleteFeed(id: string): void;
  dueFeeds(now: Date): Feed[];
  updateFeedFetchState(id: string, state: FetchState): void;
  upsertArticles(feedId: string, articles: ParsedArticle[], sanitize: (html: string) => string): Article[];
  listArticles(q: ArticleQuery): ArticleWithState[];
  setRead(userId: string, articleId: string, read: boolean): void;
  markAllRead(userId: string, feedId: string): void;
  unreadCounts(userId: string): Record<string, number>;
}
