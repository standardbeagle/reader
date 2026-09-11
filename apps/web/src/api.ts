export interface Feed {
  id: string; url: string; title: string; siteUrl: string | null;
  unreadCount: number; status: "ok" | "broken";
  lastFetchedAt: string | null; lastError: string | null; errorCount: number;
  credentialId?: string | null;
}
/** A connected account or feed sign-in. The secret never leaves the server. */
export interface Credential {
  id: string;
  provider: "generic" | "mastodon" | "reddit";
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
export interface SavedList {
  id: string; title: string; visibility: "public" | "private";
  token: string; createdAt: string; itemCount: number;
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
  id: string; kind: "mastodon" | "bluesky" | "reddit" | "composite"; config: Record<string, unknown>;
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

export function feedPlatform(url: string): "mastodon" | "bluesky" | "reddit" | "composite" | null {
  const m = /^ingestor:\/\/(mastodon|bluesky|reddit|composite)\//.exec(url);
  return (m?.[1] as "mastodon" | "bluesky" | "reddit" | "composite" | undefined) ?? null;
}

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
  listArticles: (params: { feedId?: string; listId?: string; category?: string; before?: string; beforeId?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.feedId) q.set("feed_id", params.feedId);
    if (params.listId) q.set("list_id", params.listId);
    if (params.category) q.set("category", params.category);
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
  createList: (input: { title: string; visibility: "public" | "private" }) =>
    req<SavedList>("/api/v1/lists", { method: "POST", json: input }),
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
  testIngestor: (input: { kind: string; config: Record<string, unknown>; threshold?: number; llmEnabled?: boolean }) =>
    req<IngestorTestResult>("/api/v1/ingestors/test", { method: "POST", json: input }),
};

// Demo builds (VITE_DEMO=1) serve the same surface from a bundled seed plus a
// localStorage overlay — no server involved. The dynamic import keeps the seed
// out of production chunks; the static env check makes the branch dead code.
export const api: typeof httpApi = import.meta.env.VITE_DEMO === "1"
  ? (await import("./demo/demoApi")).demoApi
  : httpApi;
