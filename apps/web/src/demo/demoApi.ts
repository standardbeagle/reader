// Demo API: the full client surface of `api`, served from a bundled seed plus
// a localStorage overlay. Read/snooze/list mutations persist locally so the
// demo is explorable; anything that needs a server (subscriptions, ingestors,
// OPML import) answers with a demo_readonly error the UI can explain.
import rawSeed from "./seed.json";
import { ApiError } from "../apiShared";
import type {
  Article,
  ArticleCursor,
  ArticlePage,
  CategoryCount,
  Feed,
  FeedRefreshResult,
  Credential,
  Ingestor,
  IngestorTestResult,
  SavedList,
  SubscribeResult,
  Chapter,
  Transcript,
} from "../api";

interface Seed {
  feeds: { id: string; url: string; title: string; siteUrl: string | null; status: "ok" | "broken"; lastFetchedAt: string | null }[];
  articles: Article[];
  lists: SavedList[];
  listItems: string[];
  /** Chapters and transcripts for the few episodes that offer them in the demo. */
  podcastExtras?: Record<string, { chapters: Chapter[] | null; transcript: Transcript | null }>;
}

const seed = rawSeed as unknown as Seed;

const STORE_KEY = "reader.demo.v1";

interface DemoState {
  v: 1;
  // Presence in `read` is an override of the seed value; null = marked unread.
  read: Record<string, string | null>;
  snoozed: Record<string, string>;
  lists: SavedList[];
  listItems: Record<string, string[]>;
}

function loadState(): DemoState {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null") as DemoState | null;
    if (parsed && parsed.v === 1) return parsed;
  } catch { /* corrupted overlay — fall through to a fresh one */ }
  return {
    v: 1,
    read: {},
    snoozed: {},
    lists: seed.lists.map((l) => ({ ...l })),
    listItems: { [seed.lists[0]?.id ?? ""]: [...seed.listItems] },
  };
}

const state = loadState();
const persist = () => localStorage.setItem(STORE_KEY, JSON.stringify(state));

const articles: Article[] = seed.articles.map((a) => ({
  ...a,
  readAt: a.id in state.read ? state.read[a.id]! : a.readAt,
  snoozedUntil: state.snoozed[a.id] ?? null,
}));

const byId = new Map(articles.map((a) => [a.id, a]));

const listIdsFor = (articleId: string) =>
  Object.entries(state.listItems).filter(([, ids]) => ids.includes(articleId)).map(([id]) => id);

const isVisible = (a: Article) =>
  !(a.snoozedUntil && Date.parse(a.snoozedUntil) > Date.now());

function page(params: { feedId?: string; listId?: string; category?: string; before?: string; beforeId?: string; limit?: number }): ArticlePage {
  let items = articles.filter(isVisible);
  if (params.feedId) items = items.filter((a) => a.feedId === params.feedId);
  if (params.listId) items = items.filter((a) => (state.listItems[params.listId!] ?? []).includes(a.id));
  if (params.category) items = items.filter((a) => a.categories?.includes(params.category!));
  // Seed is sorted newest-first; the cursor skips everything down to and
  // including the (before, beforeId) article.
  if (params.before && params.beforeId) {
    const idx = items.findIndex((a) => a.id === params.beforeId);
    if (idx >= 0) items = items.slice(idx + 1);
  }
  const limit = params.limit ?? 50;
  const slice = items.slice(0, limit);
  const last = slice[slice.length - 1];
  const nextCursor: ArticleCursor | null =
    items.length > limit && last && last.publishedAt ? { before: last.publishedAt, beforeId: last.id } : null;
  return { articles: slice, nextCursor };
}

function unreadCount(feedId: string): number {
  return articles.filter((a) => a.feedId === feedId && !a.readAt && isVisible(a)).length;
}

function readOnly(): never {
  throw new ApiError("This link needs a running reader server. The demo is seeded and read-only here.", "demo_readonly", 400);
}

function feedById(id: string): Feed | null {
  const f = seed.feeds.find((x) => x.id === id) ?? null;
  return f && { ...f, unreadCount: unreadCount(f.id), lastError: null, errorCount: 0 };
}

export const demoApi = {
  listFeeds: (): Promise<Feed[]> =>
    Promise.resolve(seed.feeds.map((f) => feedById(f.id)!)),
  refreshFeed: (id: string): Promise<FeedRefreshResult> =>
    Promise.resolve({ feed: feedById(id), newArticles: 0, notModified: true }),
  subscribe: (_url: string, _credentialId?: string): Promise<SubscribeResult> => readOnly(),
  discover: (_url: string) => readOnly(),
  importOpml: (_opml: string) => readOnly(),
  importYoutubeTakeout: (_csv: string) => readOnly(),
  unsubscribe: (_id: string) => readOnly(),
  getTranscript: (id: string): Promise<Transcript> => {
    const transcript = seed.podcastExtras?.[id]?.transcript;
    return transcript ? Promise.resolve(transcript) : Promise.reject(new ApiError("this episode has no transcript", "not_found", 404));
  },
  getChapters: (id: string): Promise<Chapter[]> => {
    const chapters = seed.podcastExtras?.[id]?.chapters;
    return chapters ? Promise.resolve(chapters) : Promise.reject(new ApiError("this episode has no chapters", "not_found", 404));
  },
  listArticles: (params: Parameters<typeof page>[0] = {}) => Promise.resolve(page(params)),
  listCategories: (feedId?: string): Promise<CategoryCount[]> => {
    const counts = new Map<string, number>();
    for (const a of articles) {
      if (!isVisible(a) || (feedId && a.feedId !== feedId)) continue;
      for (const c of a.categories ?? []) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return Promise.resolve([...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count));
  },
  getArticle: (id: string): Promise<Article> => {
    const a = byId.get(id);
    if (!a) return Promise.reject(new ApiError("article not found", "not_found", 404));
    return Promise.resolve({ ...a, listIds: listIdsFor(id) });
  },
  setRead: (id: string, read: boolean): Promise<void> => {
    const a = byId.get(id);
    if (a) {
      a.readAt = read ? new Date().toISOString() : null;
      state.read[id] = a.readAt;
      persist();
    }
    return Promise.resolve();
  },
  setSnooze: (id: string, until: string | null): Promise<void> => {
    const a = byId.get(id);
    if (a) {
      a.snoozedUntil = until;
      if (until) state.snoozed[id] = until;
      else delete state.snoozed[id];
      persist();
    }
    return Promise.resolve();
  },
  listLists: (): Promise<SavedList[]> =>
    Promise.resolve(state.lists.map((l) => ({ ...l, itemCount: (state.listItems[l.id] ?? []).length }))),
  createList: (input: { title: string; visibility: "public" | "private" }): Promise<SavedList> => {
    const list: SavedList = {
      id: crypto.randomUUID(),
      title: input.title,
      visibility: input.visibility,
      token: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      itemCount: 0,
    };
    state.lists.push(list);
    state.listItems[list.id] = [];
    persist();
    return Promise.resolve(list);
  },
  deleteList: (id: string): Promise<void> => {
    state.lists = state.lists.filter((l) => l.id !== id);
    delete state.listItems[id];
    persist();
    return Promise.resolve();
  },
  addToList: (listId: string, articleId: string): Promise<void> => {
    const items = state.listItems[listId] ?? (state.listItems[listId] = []);
    if (!items.includes(articleId)) items.push(articleId);
    persist();
    return Promise.resolve();
  },
  removeFromList: (listId: string, articleId: string): Promise<void> => {
    state.listItems[listId] = (state.listItems[listId] ?? []).filter((id) => id !== articleId);
    persist();
    return Promise.resolve();
  },
  markAllRead: (feedId: string): Promise<void> => {
    const now = new Date().toISOString();
    for (const a of articles) {
      if (a.feedId !== feedId || a.readAt) continue;
      a.readAt = now;
      state.read[a.id] = now;
    }
    persist();
    return Promise.resolve();
  },
  listIngestors: (): Promise<Ingestor[]> => Promise.resolve([]),
  createIngestor: () => readOnly(),
  updateIngestor: () => readOnly(),
  deleteIngestor: () => readOnly(),
  listCredentials: (): Promise<Credential[]> => Promise.resolve([]),
  createCredential: () => readOnly(),
  deleteCredential: (_id: string) => readOnly(),
  startOAuth: () => readOnly(),
  testIngestor: (): Promise<IngestorTestResult> => readOnly(),
};
