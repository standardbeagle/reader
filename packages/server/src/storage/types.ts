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
  lastError: string | null;
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
  imageUrl: string | null;
  /** Subject tags from the feed, stored as a JSON array column. */
  categories: string[];
  fetchedAt: string;
}

export interface ArticleWithState extends Article {
  readAt: string | null;
  /** When set and in the future, the article stays unread but is hidden from
   *  the default list and unread counts until this time passes. */
  snoozedUntil: string | null;
  /** Saved lists this article belongs to (populated by getArticle). */
  listIds?: string[];
}

export interface ArticleQuery {
  userId: string;
  feedId?: string;
  /** Restrict to articles saved in this list. */
  listId?: string;
  unreadOnly?: boolean;
  category?: string;
  before?: string; // ISO date cursor on published_at
  /** Second half of the (published_at, id) keyset cursor; prevents skipping
   *  articles that share the boundary timestamp. */
  beforeId?: string;
  limit: number;
  /** Keep list responses light unless a caller explicitly needs article content. */
  includeContent?: boolean;
  /** Include actively snoozed articles instead of hiding them. */
  includeSnoozed?: boolean;
}

export type ListVisibility = "public" | "private";

export interface SavedList {
  id: string;
  userId: string;
  title: string;
  visibility: ListVisibility;
  /** Capability token for the public RSS URL; meaningless for private lists. */
  token: string;
  createdAt: string;
}

export interface SavedListWithCount extends SavedList {
  itemCount: number;
}

export interface CategoryCount {
  name: string;
  count: number;
}

export interface FetchState {
  etag?: string | null;
  lastModified?: string | null;
  lastFetchedAt: string;
  lastError?: string | null;
  fetchIntervalMin: number;
  errorCount: number;
  status: "ok" | "broken";
  title?: string;
  siteUrl?: string | null;
}

export interface NormalizedItem {
  externalId: string;
  author: string | null;
  title: string | null;
  text: string;
  url: string | null;
  publishedAt: string | null;
}

export type IngestorKind = "mastodon" | "bluesky" | "reddit";
export type DigestMode = "realtime" | "hourly" | "daily";

export interface Ingestor {
  id: string;
  userId: string;
  kind: IngestorKind;
  config: Record<string, unknown>;
  feedId: string;
  fetchIntervalMin: number;
  digestMode: DigestMode;
  filterThreshold: number;
  llmEnabled: boolean;
  status: "ok" | "broken";
  errorCount: number;
  lastFetchedAt: string | null;
  lastDeliveredAt: string | null;
  cursor: Record<string, unknown> | null;
  createdAt: string;
}

export interface IngestorPatch {
  fetchIntervalMin?: number;
  digestMode?: DigestMode;
  filterThreshold?: number;
  llmEnabled?: boolean;
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
  upsertArticles(feedId: string, articles: ParsedArticle[], sanitize: (html: string, baseUrl?: string) => string, baseUrl?: string): Article[];
  listArticles(q: ArticleQuery): ArticleWithState[];
  listCategories(userId: string, feedId?: string): CategoryCount[];
  getArticle(userId: string, articleId: string): ArticleWithState | null;
  setRead(userId: string, articleId: string, read: boolean): void;
  /** until=null clears the snooze; the article stays unread either way. */
  setSnooze(userId: string, articleId: string, until: Date | null): void;
  markAllRead(userId: string, feedId: string): void;
  unreadCounts(userId: string): Record<string, number>;
  createList(userId: string, input: { title: string; visibility: ListVisibility }): SavedList;
  listLists(userId: string): SavedListWithCount[];
  getList(id: string): SavedList | null;
  getListByToken(token: string): SavedList | null;
  deleteList(id: string): void;
  addToList(listId: string, articleId: string): void;
  removeFromList(listId: string, articleId: string): void;
  /** Articles in a list, newest saved first, content included (for RSS output). */
  listListArticles(listId: string, limit: number): Article[];
  createIngestor(userId: string, input: { kind: IngestorKind; config: Record<string, unknown>; feedId: string }): Ingestor;
  listIngestors(userId: string): Ingestor[];
  getIngestor(id: string): Ingestor | null;
  updateIngestor(id: string, patch: IngestorPatch): Ingestor;
  deleteIngestor(id: string): void;
  dueIngestors(now: Date): Ingestor[];
  dueDigestFlushes(now: Date): Ingestor[];
  updateIngestorState(id: string, state: { lastFetchedAt?: string; lastDeliveredAt?: string; cursor?: Record<string, unknown>; errorCount: number; status: "ok" | "broken" }): void;
  stageItems(ingestorId: string, items: NormalizedItem[]): NormalizedItem[];
  pendingItems(ingestorId: string): NormalizedItem[];
  markDelivered(ingestorId: string, externalIds: string[]): void;
}
