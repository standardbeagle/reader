/** What a feed carries, derived by the server from its address and articles. */
export type FeedKind = "article" | "podcast" | "video" | "social" | "library";
export const FEED_KINDS: readonly FeedKind[] = ["article", "podcast", "video", "social", "library"];
/** Playable articles only: any media, or just audio or just video. */
export type MediaFilter = "any" | "audio" | "video";
export interface Feed {
  id: string; url: string; title: string; siteUrl: string | null;
  unreadCount: number; status: "ok" | "broken";
  lastFetchedAt: string | null; lastError: string | null; errorCount: number;
  credentialId?: string | null;
  /** The user's own grouping; null when uncategorized. */
  category: string | null;
  kind: FeedKind;
}
/** A connected account or feed sign-in. The secret never leaves the server. */
export interface Credential {
  id: string;
  provider: "generic" | "mastodon" | "reddit" | "libby";
  kind: "basic" | "bearer" | "oauth2";
  label: string;
  origin: string;
  createdAt: string;
  usedBy: number;
}
export type OAuthStart =
  | { provider: "mastodon"; instance: string }
  | { provider: "reddit"; clientId: string; clientSecret: string }
  | { provider: "generic"; feedUrl: string; authorizeUrl: string; tokenUrl: string; clientId: string; clientSecret?: string; scope?: string };
export interface Article {
  id: string; feedId: string; title: string; url: string | null;
  author: string | null; publishedAt: string | null;
  contentHtml: string | null; summary: string | null; imageUrl?: string | null; readAt: string | null;
  snoozedUntil?: string | null;
  /** Saved lists this article belongs to (present on single-article fetches). */
  listIds?: string[];
  categories?: string[];
  /** Playable audio/video — a podcast episode. */
  media?: { url: string; type: string | null } | null;
  transcript?: { url: string; type: string | null } | null;
  chaptersUrl?: string | null;
}
export type Transcript =
  | { kind: "cues"; cues: { start: number; text: string; speaker: string | null }[] }
  | { kind: "html"; html: string }
  | { kind: "text"; text: string };
export interface Chapter { start: number; title: string; url: string | null; img: string | null }
/** embeddable is null when the page could not be checked. */
export interface Embeddability { embeddable: boolean | null; reason: string | null }
/** What a dynamic list contains: every article matching all the set fields. */
export interface ListRule {
  feedIds?: string[];
  feedCategory?: string;
  feedKind?: FeedKind;
  category?: string;
  media?: MediaFilter;
  unreadOnly?: boolean;
  maxAgeDays?: number;
  order?: "newest" | "oldest";
}
export interface SavedList {
  id: string; title: string; visibility: "public" | "private";
  token: string; createdAt: string; itemCount: number;
  /** Null for a manual list (saved articles, in order); a rule fills a dynamic list. */
  rule: ListRule | null;
}
export interface ArticleQueryParams {
  feedId?: string; listId?: string; feedCategory?: string; feedKind?: FeedKind; category?: string;
  media?: MediaFilter; before?: string; beforeId?: string; limit?: number;
}
export interface CategoryCount { name: string; count: number }
export interface ArticleCursor { before: string; beforeId: string }
export interface ArticlePage { articles: Article[]; nextCursor: ArticleCursor | null }
export interface DiscoveredFeed { url: string; title: string; kind: "rss" | "atom" | "json" | "h-feed" }
export type SubscribeResult = { status: "subscribed"; feed: Feed } | { status: "choices"; feeds: DiscoveredFeed[] };
export interface FeedRefreshResult {
  feed: Feed | null;
  newArticles: number;
  notModified?: boolean;
}

export interface Ingestor {
  id: string; kind: "mastodon" | "bluesky" | "reddit" | "composite" | "libby"; config: Record<string, unknown>;
  feedId: string; feedTitle: string | null; fetchIntervalMin: number;
  digestMode: "realtime" | "hourly" | "daily"; filterThreshold: number;
  llmEnabled: boolean; status: "ok" | "broken"; pendingCount: number;
}
export interface IngestorTestResult {
  kept: { title: string; summary: string; score: number | null; url: string | null; author: string | null }[];
  dropped: { title: string; score: number; reason: string }[];
}

export interface ImportResult {
  added: Feed[];
  skipped: { title: string; url: string; reason: string }[];
}

export type FeedPlatform = "mastodon" | "bluesky" | "reddit" | "composite" | "libby";
export function feedPlatform(url: string): FeedPlatform | null {
  const m = /^ingestor:\/\/(mastodon|bluesky|reddit|composite|libby)\//.exec(url);
  return (m?.[1] as FeedPlatform | undefined) ?? null;
}

export interface LibbyCard { cardId: string; library: string; libraryKey: string | null }
export interface LibbyHold {
  titleId: string; cardId: string; title: string; author: string | null; format: string | null;
  /** The patron's place in the queue. */
  position: number | null;
  holdsCount: number | null; ownedCopies: number | null; estimatedWaitDays: number | null;
  /** The copy is waiting to be borrowed. */
  ready: boolean;
  placedAt: string | null; expiresAt: string | null; suspendedUntil: string | null; coverUrl: string | null;
}
/** The Libby account as of the last sync. */
export type LibbyState =
  | { linked: false }
  | {
    linked: true; feedId: string; cards: LibbyCard[]; holds: LibbyHold[];
    lastSyncedAt: string | null; lastError: string | null; signInExpiresAt: string | null;
    /** The sign-in lapsed or was removed; only a new setup code revives it. */
    needsRelink: boolean;
  };
export interface LibbyCatalogTitle {
  titleId: string; title: string; author: string | null; format: string | null; available: boolean;
  ownedCopies: number | null; holdsCount: number | null; estimatedWaitDays: number | null; coverUrl: string | null;
}
export interface LibbySearchResult { cardId: string; library: string; titles: LibbyCatalogTitle[] }

// ApiError lives in apiShared so the demo adapter can throw it without
// importing this module — a circular import would deadlock the top-level
// await that selects the demo implementation below.
import { ApiError } from "./apiShared";
export { ApiError } from "./apiShared";

async function req<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  let res: Response;
  try {
    const { json, headers, body, ...rest } = init ?? {};
    const requestInit: RequestInit = { ...rest };
    if (json !== undefined) {
      requestInit.headers = { "content-type": "application/json" };
      requestInit.body = JSON.stringify(json);
    } else {
      if (headers !== undefined) requestInit.headers = headers;
      if (body !== undefined) requestInit.body = body;
    }
    res = await fetch(path, requestInit);
  } catch {
    throw new ApiError("network request failed", "network", 0);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(body?.error?.message ?? `HTTP ${res.status}`, body?.error?.code ?? null, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const httpApi = {
  listFeeds: () => req<{ feeds: Feed[] }>("/api/v1/feeds").then((r) => r.feeds),
  refreshFeed: (id: string) => req<FeedRefreshResult>(`/api/v1/feeds/${id}/refresh`, { method: "POST" }),
  subscribe: async (url: string, credentialId?: string): Promise<SubscribeResult> => {
    let res: Response;
    try {
      res = await fetch("/api/v1/feeds", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(credentialId ? { url, credentialId } : { url }),
      });
    } catch {
      throw new ApiError("network request failed", "network", 0);
    }
    if (res.status === 201) return { status: "subscribed", feed: await res.json() };
    if (res.status === 200) { const b = await res.json(); return { status: "choices", feeds: b.feeds }; }
    const body = await res.json().catch(() => null);
    throw new ApiError(body?.error?.message ?? `HTTP ${res.status}`, body?.error?.code ?? null, res.status);
  },
  discover: (url: string) => req<{ feeds: DiscoveredFeed[] }>("/api/v1/feeds/discover", { method: "POST", json: { url } }).then((r) => r.feeds),
  importOpml: (opml: string) =>
    req<ImportResult>("/api/v1/feeds/import", { method: "POST", json: { opml } }),
  importYoutubeTakeout: (csv: string) =>
    req<ImportResult>("/api/v1/feeds/import/youtube", { method: "POST", json: { csv } }),
  unsubscribe: (id: string) => req<void>(`/api/v1/feeds/${id}`, { method: "DELETE" }),
  setFeedCategory: (id: string, category: string | null) =>
    req<Feed>(`/api/v1/feeds/${id}`, { method: "PATCH", json: { category } }),
  listArticles: (params: ArticleQueryParams = {}) => {
    const q = new URLSearchParams();
    if (params.feedId) q.set("feed_id", params.feedId);
    if (params.listId) q.set("list_id", params.listId);
    if (params.feedCategory) q.set("feed_category", params.feedCategory);
    if (params.feedKind) q.set("feed_kind", params.feedKind);
    if (params.category) q.set("category", params.category);
    if (params.media) q.set("media", params.media);
    if (params.before) q.set("before", params.before);
    if (params.beforeId) q.set("before_id", params.beforeId);
    if (params.limit) q.set("limit", String(params.limit));
    return req<ArticlePage>(`/api/v1/articles?${q}`);
  },
  listCategories: (feedId?: string) => {
    const q = new URLSearchParams();
    if (feedId) q.set("feed_id", feedId);
    return req<{ categories: CategoryCount[] }>(`/api/v1/categories?${q}`).then((r) => r.categories);
  },
  getArticle: (id: string) => req<Article>(`/api/v1/articles/${encodeURIComponent(id)}`),
  getTranscript: (id: string) => req<Transcript>(`/api/v1/articles/${encodeURIComponent(id)}/transcript`),
  getEmbeddability: (id: string) => req<Embeddability>(`/api/v1/articles/${encodeURIComponent(id)}/embeddable`),
  getChapters: (id: string) => req<{ chapters: Chapter[] }>(`/api/v1/articles/${encodeURIComponent(id)}/chapters`).then((r) => r.chapters),
  setRead: (id: string, read: boolean) =>
    req<void>(`/api/v1/articles/${id}/read`, { method: "POST", json: { read } }),
  setSnooze: (id: string, until: string | null) =>
    req<void>(`/api/v1/articles/${id}/snooze`, { method: "POST", json: { until } }),
  listLists: () => req<{ lists: SavedList[] }>("/api/v1/lists").then((r) => r.lists),
  createList: (input: { title: string; visibility: "public" | "private"; rule?: ListRule }) =>
    req<SavedList>("/api/v1/lists", { method: "POST", json: input }),
  updateList: (id: string, patch: { title?: string; rule?: ListRule }) =>
    req<SavedList>(`/api/v1/lists/${id}`, { method: "PATCH", json: patch }),
  setListItems: (listId: string, articleIds: string[]) =>
    req<void>(`/api/v1/lists/${listId}/items`, { method: "PUT", json: { articleIds } }),
  deleteList: (id: string) => req<void>(`/api/v1/lists/${id}`, { method: "DELETE" }),
  addToList: (listId: string, articleId: string) =>
    req<void>(`/api/v1/lists/${listId}/items`, { method: "POST", json: { articleId } }),
  removeFromList: (listId: string, articleId: string) =>
    req<void>(`/api/v1/lists/${listId}/items/${articleId}`, { method: "DELETE" }),
  markAllRead: (feedId: string) =>
    req<void>(`/api/v1/feeds/${feedId}/mark-all-read`, { method: "POST" }),
  listIngestors: () => req<{ ingestors: Ingestor[] }>("/api/v1/ingestors").then((r) => r.ingestors),
  createIngestor: (input: { kind: string; config: Record<string, unknown>; fetchIntervalMin?: number; digestMode?: string; filterThreshold?: number; llmEnabled?: boolean }) =>
    req<Ingestor>("/api/v1/ingestors", { method: "POST", json: input }),
  updateIngestor: (id: string, patch: Partial<{ fetchIntervalMin: number; digestMode: string; filterThreshold: number; llmEnabled: boolean; credentialId: string | null }>) =>
    req<Ingestor>(`/api/v1/ingestors/${id}`, { method: "PATCH", json: patch }),
  deleteIngestor: (id: string) => req<void>(`/api/v1/ingestors/${id}`, { method: "DELETE" }),
  listCredentials: () => req<{ credentials: Credential[] }>("/api/v1/credentials").then((r) => r.credentials),
  createCredential: (input: { kind: "basic"; url: string; username: string; password: string } | { kind: "bearer"; url: string; token: string }) =>
    req<Credential>("/api/v1/credentials", { method: "POST", json: input }),
  deleteCredential: (id: string) => req<void>(`/api/v1/credentials/${id}`, { method: "DELETE" }),
  startOAuth: (input: OAuthStart) => req<{ authorizeUrl: string }>("/api/v1/oauth/start", { method: "POST", json: input }),
  getLibby: () => req<LibbyState>("/api/v1/libby"),
  linkLibby: (code: string) => req<LibbyState>("/api/v1/libby/link", { method: "POST", json: { code } }),
  unlinkLibby: () => req<void>("/api/v1/libby", { method: "DELETE" }),
  syncLibby: () => req<LibbyState>("/api/v1/libby/sync", { method: "POST" }),
  searchLibby: (query: string, cardId?: string) => {
    const q = new URLSearchParams({ q: query });
    if (cardId) q.set("card_id", cardId);
    return req<LibbySearchResult>(`/api/v1/libby/search?${q}`);
  },
  placeLibbyHold: (cardId: string, titleId: string) =>
    req<LibbyState>("/api/v1/libby/holds", { method: "POST", json: { cardId, titleId } }),
  cancelLibbyHold: (cardId: string, titleId: string) =>
    req<LibbyState>(`/api/v1/libby/holds/${encodeURIComponent(cardId)}/${encodeURIComponent(titleId)}`, { method: "DELETE" }),
  /** days = 0 lifts a suspension. */
  suspendLibbyHold: (cardId: string, titleId: string, days: number) =>
    req<LibbyState>(`/api/v1/libby/holds/${encodeURIComponent(cardId)}/${encodeURIComponent(titleId)}/suspend`, { method: "POST", json: { days } }),
  borrowLibbyHold: (cardId: string, titleId: string) =>
    req<LibbyState>(`/api/v1/libby/holds/${encodeURIComponent(cardId)}/${encodeURIComponent(titleId)}/borrow`, { method: "POST" }),
  testIngestor: (input: { kind: string; config: Record<string, unknown>; threshold?: number; llmEnabled?: boolean }) =>
    req<IngestorTestResult>("/api/v1/ingestors/test", { method: "POST", json: input }),
};

// Demo builds (VITE_DEMO=1) serve the same surface from a bundled seed plus a
// localStorage overlay — no server involved. The dynamic import keeps the seed
// out of production chunks; the static env check makes the branch dead code.
export const api: typeof httpApi = import.meta.env.VITE_DEMO === "1"
  ? (await import("./demo/demoApi")).demoApi
  : httpApi;
