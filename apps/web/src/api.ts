export interface Feed {
  id: string; url: string; title: string; siteUrl: string | null;
  unreadCount: number; status: "ok" | "broken";
}
export interface Article {
  id: string; feedId: string; title: string; url: string | null;
  author: string | null; publishedAt: string | null;
  contentHtml: string | null; summary: string | null; readAt: string | null;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  listFeeds: () => req<{ feeds: Feed[] }>("/api/v1/feeds").then((r) => r.feeds),
  subscribe: (url: string) =>
    req<Feed>("/api/v1/feeds", { method: "POST", body: JSON.stringify({ url }) }),
  unsubscribe: (id: string) => req<void>(`/api/v1/feeds/${id}`, { method: "DELETE" }),
  listArticles: (params: { feedId?: string; unread?: boolean } = {}) => {
    const q = new URLSearchParams();
    if (params.feedId) q.set("feed_id", params.feedId);
    if (params.unread) q.set("unread", "1");
    return req<{ articles: Article[] }>(`/api/v1/articles?${q}`).then((r) => r.articles);
  },
  setRead: (id: string, read: boolean) =>
    req<void>(`/api/v1/articles/${id}/read`, { method: "POST", body: JSON.stringify({ read }) }),
  markAllRead: (feedId: string) =>
    req<void>(`/api/v1/feeds/${feedId}/mark-all-read`, { method: "POST" }),
};
