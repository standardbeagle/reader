import type { ArticleMedia, ParsedArticle } from "@reader/core";

export interface User { id: string; email: string | null; createdAt: string; }

/** What a feed carries, derived from its address and its articles. */
export type FeedKind = "article" | "podcast" | "video" | "social";
export const FEED_KINDS: readonly FeedKind[] = ["article", "podcast", "video", "social"];

/** Playable articles only: any media, or just audio or just video. */
export type MediaFilter = "any" | "audio" | "video";
export const MEDIA_FILTERS: readonly MediaFilter[] = ["any", "audio", "video"];

export type ArticleOrder = "newest" | "oldest";

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
  /** Credential sent with every fetch of this feed; null for public feeds. */
  credentialId: string | null;
  /** The publisher's Retry-After: scheduled polls wait until then. */
  retryAfter: string | null;
  /** The user's own grouping; null when uncategorized. */
  category: string | null;
  kind: FeedKind;
  createdAt: string;
}

export type CredentialProvider = "generic" | "mastodon" | "reddit";

export type CredentialSecret =
  | { kind: "basic"; username: string; password: string }
  | { kind: "bearer"; token: string }
  | {
    kind: "oauth2";
    tokenUrl: string;
    clientId: string;
    clientSecret: string | null;
    accessToken: string;
    refreshToken: string | null;
    /** ISO time the access token stops working; null when it does not expire. */
    expiresAt: string | null;
  };

export interface Credential {
  id: string;
  userId: string;
  provider: CredentialProvider;
  /** Human name: an account handle, or the host a feed credential serves. */
  label: string;
  /** The only scheme://host[:port] this credential is ever sent to. */
  origin: string;
  secret: CredentialSecret;
  createdAt: string;
  updatedAt: string;
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
  /** Playable audio/video; present on list rows too so they can show it. */
  media: ArticleMedia | null;
  transcript: ArticleMedia | null;
  chaptersUrl: string | null;
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
  /** Restrict to these feeds. */
  feedIds?: string[];
  /** Restrict to feeds the user filed under this category. */
  feedCategory?: string;
  feedKind?: FeedKind;
  unreadOnly?: boolean;
  category?: string;
  media?: MediaFilter;
  /** Only articles published within this many days. */
  maxAgeDays?: number;
  /** Defaults to newest. */
  order?: ArticleOrder;
  /** Keyset cursor: the last row's published_at. */
  before?: string;
  /** Second half of the keyset cursor; prevents skipping articles that share
   *  the boundary value. */
  beforeId?: string;
  limit: number;
  /** Keep list responses light unless a caller explicitly needs article content. */
  includeContent?: boolean;
  /** Include actively snoozed articles instead of hiding them. */
  includeSnoozed?: boolean;
}

export interface ArticleCursor { before: string; beforeId: string }

export interface ArticlePage {
  articles: ArticleWithState[];
  /** Null on the last page. */
  nextCursor: ArticleCursor | null;
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
  /** Replaces the stored Retry-After; null clears it. */
  retryAfter?: string | null;
}

export interface NormalizedItem {
  externalId: string;
  author: string | null;
  title: string | null;
  text: string;
  url: string | null;
  publishedAt: string | null;
}

export type IngestorKind = "mastodon" | "bluesky" | "reddit" | "composite";
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
  /** Replaces the whole adapter config. */
  config?: Record<string, unknown>;
  fetchIntervalMin?: number;
  digestMode?: DigestMode;
  filterThreshold?: number;
  llmEnabled?: boolean;
}

export interface Storage {
  close(): void | Promise<void>;
  getOrCreateLocalUser(): User;
  createFeed(userId: string, input: { url: string; title: string; siteUrl: string | null; credentialId?: string | null; category?: string | null }): Feed;
  listFeeds(userId: string): Feed[];
  getFeed(id: string): Feed | null;
  setFeedCategory(id: string, category: string | null): void;
  deleteFeed(id: string): void;
  dueFeeds(now: Date): Feed[];
  /** Feeds with at least one playable episode — the ones Podping can announce. */
  podcastFeeds(): { id: string; url: string }[];
  updateFeedFetchState(id: string, state: FetchState): void;
  upsertArticles(feedId: string, articles: ParsedArticle[], sanitize: (html: string, baseUrl?: string) => string, baseUrl?: string): Article[];
  listArticles(q: ArticleQuery): ArticleWithState[];
  /** One page of articles plus the cursor that continues it. */
  listArticlePage(q: ArticleQuery): ArticlePage;
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
  createCredential(userId: string, input: { provider: CredentialProvider; label: string; origin: string; secret: CredentialSecret }): Credential;
  listCredentials(userId: string): Credential[];
  getCredential(id: string): Credential | null;
  updateCredentialSecret(id: string, secret: CredentialSecret): void;
  deleteCredential(id: string): void;
}
