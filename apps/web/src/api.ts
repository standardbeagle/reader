export interface Feed {
  id: string; url: string; title: string; siteUrl: string | null;
  unreadCount: number; status: "ok" | "broken";
}
export interface Article {
  id: string; feedId: string; title: string; url: string | null;
  author: string | null; publishedAt: string | null;
  contentHtml: string | null; summary: string | null; readAt: string | null;
}
export interface DiscoveredFeed { url: string; title: string; kind: "rss" | "atom" | "json" }
export type SubscribeResult = { status: "subscribed"; feed: Feed } | { status: "choices"; feeds: DiscoveredFeed[] };

export interface Ingestor {
  id: string; kind: "mastodon" | "bluesky" | "reddit"; config: Record<string, unknown>;
  feedId: string; feedTitle: string | null; fetchIntervalMin: number;
  digestMode: "realtime" | "hourly" | "daily"; filterThreshold: number;
  llmEnabled: boolean; status: "ok" | "broken"; pendingCount: number;
}
export interface IngestorTestResult {
  kept: { title: string; summary: string; score: number | null; url: string | null; author: string | null }[];
  dropped: { title: string; score: number; reason: string }[];
}

export function feedPlatform(url: string): "mastodon" | "bluesky" | "reddit" | null {
  const m = /^ingestor:\/\/(mastodon|bluesky|reddit)\//.exec(url);
  return (m?.[1] as "mastodon" | "bluesky" | "reddit" | undefined) ?? null;
}

export class ApiError extends Error {
  constructor(message: string, public code: string | null, public status: number) { super(message); }
}

async function req<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: init?.json !== undefined ? { "content-type": "application/json" } : init?.headers,
      body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
    });
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

export const api = {
  listFeeds: () => req<{ feeds: Feed[] }>("/api/v1/feeds").then((r) => r.feeds),
  subscribe: async (url: string): Promise<SubscribeResult> => {
    let res: Response;
    try {
      res = await fetch("/api/v1/feeds", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }),
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
  unsubscribe: (id: string) => req<void>(`/api/v1/feeds/${id}`, { method: "DELETE" }),
  listArticles: (params: { feedId?: string; unread?: boolean } = {}) => {
    const q = new URLSearchParams();
    if (params.feedId) q.set("feed_id", params.feedId);
    if (params.unread) q.set("unread", "1");
    return req<{ articles: Article[] }>(`/api/v1/articles?${q}`).then((r) => r.articles);
  },
  setRead: (id: string, read: boolean) =>
    req<void>(`/api/v1/articles/${id}/read`, { method: "POST", json: { read } }),
  markAllRead: (feedId: string) =>
    req<void>(`/api/v1/feeds/${feedId}/mark-all-read`, { method: "POST" }),
  listIngestors: () => req<{ ingestors: Ingestor[] }>("/api/v1/ingestors").then((r) => r.ingestors),
  createIngestor: (input: { kind: string; config: Record<string, unknown>; fetchIntervalMin?: number; digestMode?: string; filterThreshold?: number; llmEnabled?: boolean }) =>
    req<Ingestor>("/api/v1/ingestors", { method: "POST", json: input }),
  updateIngestor: (id: string, patch: Partial<{ fetchIntervalMin: number; digestMode: string; filterThreshold: number; llmEnabled: boolean }>) =>
    req<Ingestor>(`/api/v1/ingestors/${id}`, { method: "PATCH", json: patch }),
  deleteIngestor: (id: string) => req<void>(`/api/v1/ingestors/${id}`, { method: "DELETE" }),
  testIngestor: (input: { kind: string; config: Record<string, unknown>; threshold?: number; llmEnabled?: boolean }) =>
    req<IngestorTestResult>("/api/v1/ingestors/test", { method: "POST", json: input }),
};
