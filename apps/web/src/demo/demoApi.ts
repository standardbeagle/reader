// Demo API: the full client surface of `api`, served from a bundled seed plus
// a localStorage overlay. Read/snooze/list mutations persist locally so the
// demo is explorable; anything that needs a server (subscriptions, ingestors,
// OPML import) answers with a demo_readonly error the UI can explain.
import rawSeed from "./seed.json";
import { ApiError } from "../apiShared";
import { youtubeVideo } from "../youtube";
import type {
  Article,
  ArticleCursor,
  ArticlePage,
  ArticleQueryParams,
  FeedKind,
  LibbyState,
  ListRule,
  MediaFilter,
  CategoryCount,
  Feed,
  FeedRefreshResult,
  Credential,
  Ingestor,
  IngestorTestResult,
  SavedList,
  SubscribeResult,
  Chapter,
  Embeddability,
  Transcript,
} from "../api";

interface Seed {
  feeds: { id: string; url: string; title: string; siteUrl: string | null; status: "ok" | "broken"; lastFetchedAt: string | null }[];
  articles: Article[];
  lists: SavedList[];
  listItems: string[];
  /** Framing checks for each article's page, taken when the seed was built. */
  embeddability?: Record<string, Embeddability>;
  /** Chapters and transcripts for the few episodes that offer them in the demo. */
  podcastExtras?: Record<string, { chapters: Chapter[] | null; transcript: Transcript | null }>;
}

const seed = rawSeed as unknown as Seed;

// v2: the seed's list changed, and the overlay keeps its own copy of lists.
const STORE_KEY = "reader.demo.v2";

interface DemoState {
  v: 1;
  // Presence in `read` is an override of the seed value; null = marked unread.
  read: Record<string, string | null>;
  snoozed: Record<string, string>;
  lists: SavedList[];
  /** A manual list's articles, in playing order. */
  listItems: Record<string, string[]>;
  /** feedId → the visitor's category for it. Absent in overlays saved before categories existed. */
  feedCategories?: Record<string, string>;
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
    feedCategories: {},
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

const isVideo = (a: Article) => Boolean(a.media?.type?.startsWith("video/")) || youtubeVideo(a.url) !== null;

function matchesMedia(a: Article, media: MediaFilter): boolean {
  if (media === "video") return isVideo(a);
  if (media === "audio") return Boolean(a.media) && !isVideo(a);
  return Boolean(a.media) || isVideo(a);
}

// The same derivation the server does in SQL: a feed is what it carries.
const feedKinds = new Map<string, FeedKind>(seed.feeds.map((f) => {
  const own = seed.articles.filter((a) => a.feedId === f.id);
  const kind: FeedKind = f.url.startsWith("ingestor://") ? "social"
    : f.url.startsWith("https://www.youtube.com/feeds/") || own.some((a) => a.media?.type?.startsWith("video/")) ? "video"
    : own.some((a) => a.media) ? "podcast" : "article";
  return [f.id, kind];
}));

const feedCategory = (feedId: string): string | null => state.feedCategories?.[feedId] ?? null;

/** A dynamic list's rule, applied to already-visible articles. */
function applyRule(items: Article[], rule: ListRule): Article[] {
  const oldest = rule.maxAgeDays !== undefined ? Date.now() - rule.maxAgeDays * 86_400_000 : null;
  const matched = items.filter((a) =>
    (!rule.feedIds || rule.feedIds.includes(a.feedId))
    && (!rule.feedCategory || feedCategory(a.feedId) === rule.feedCategory)
    && (!rule.feedKind || feedKinds.get(a.feedId) === rule.feedKind)
    && (!rule.category || Boolean(a.categories?.includes(rule.category)))
    && (!rule.media || matchesMedia(a, rule.media))
    && (!rule.unreadOnly || !a.readAt)
    && (oldest === null || (a.publishedAt !== null && Date.parse(a.publishedAt) >= oldest)));
  return rule.order === "oldest" ? matched.reverse() : matched;
}

function page(params: ArticleQueryParams): ArticlePage {
  let items = articles.filter(isVisible);
  const list = params.listId ? state.lists.find((l) => l.id === params.listId) : undefined;
  if (list?.rule) items = applyRule(items, list.rule);
  else if (params.listId) {
    // A manual list plays in its own order, not by date.
    const order = state.listItems[params.listId] ?? [];
    items = items.filter((a) => order.includes(a.id)).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }
  if (params.feedId) items = items.filter((a) => a.feedId === params.feedId);
  if (params.feedCategory) items = items.filter((a) => feedCategory(a.feedId) === params.feedCategory);
  if (params.feedKind) items = items.filter((a) => feedKinds.get(a.feedId) === params.feedKind);
  if (params.media) items = items.filter((a) => matchesMedia(a, params.media!));
  if (params.category) items = items.filter((a) => a.categories?.includes(params.category!));
  // Seed is sorted newest-first; whatever the order, the cursor skips
  // everything down to and including the (before, beforeId) article.
  if (params.before && params.beforeId) {
    const idx = items.findIndex((a) => a.id === params.beforeId);
    if (idx >= 0) items = items.slice(idx + 1);
  }
  const limit = params.limit ?? 50;
  const slice = items.slice(0, limit);
  const last = slice[slice.length - 1];
  const nextCursor: ArticleCursor | null =
    items.length > limit && last ? { before: last.publishedAt ?? last.id, beforeId: last.id } : null;
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
  return f && { ...f, unreadCount: unreadCount(f.id), lastError: null, errorCount: 0, category: feedCategory(f.id), kind: feedKinds.get(f.id)! };
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
  setFeedCategory: (id: string, category: string | null): Promise<Feed> => {
    const categories = (state.feedCategories ??= {});
    if (category) categories[id] = category;
    else delete categories[id];
    persist();
    const feed = feedById(id);
    return feed ? Promise.resolve(feed) : Promise.reject(new ApiError("feed not found", "not_found", 404));
  },
  getTranscript: (id: string): Promise<Transcript> => {
    const transcript = seed.podcastExtras?.[id]?.transcript;
    return transcript ? Promise.resolve(transcript) : Promise.reject(new ApiError("this episode has no transcript", "not_found", 404));
  },
  getEmbeddability: (id: string): Promise<Embeddability> =>
    Promise.resolve(seed.embeddability?.[id] ?? { embeddable: null, reason: null }),
  getChapters: (id: string): Promise<Chapter[]> => {
    const chapters = seed.podcastExtras?.[id]?.chapters;
    return chapters ? Promise.resolve(chapters) : Promise.reject(new ApiError("this episode has no chapters", "not_found", 404));
  },
  listArticles: (params: ArticleQueryParams = {}) => Promise.resolve(page(params)),
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
    Promise.resolve(state.lists.map((l) => {
      // Lists saved before rules existed have no `rule` key at all.
      const rule = l.rule ?? null;
      return { ...l, rule, itemCount: rule ? applyRule(articles.filter(isVisible), rule).length : (state.listItems[l.id] ?? []).length };
    })),
  createList: (input: { title: string; visibility: "public" | "private"; rule?: ListRule }): Promise<SavedList> => {
    const list: SavedList = {
      id: crypto.randomUUID(),
      title: input.title,
      visibility: input.visibility,
      token: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      itemCount: 0,
      rule: input.rule ?? null,
    };
    state.lists.push(list);
    state.listItems[list.id] = [];
    persist();
    return Promise.resolve(list);
  },
  updateList: (id: string, patch: { title?: string; rule?: ListRule }): Promise<SavedList> => {
    const list = state.lists.find((l) => l.id === id);
    if (!list) return Promise.reject(new ApiError("list not found", "not_found", 404));
    if (patch.rule && !list.rule) return Promise.reject(new ApiError("this list holds saved articles; create a dynamic list instead", "list_manual", 409));
    if (patch.title) list.title = patch.title;
    if (patch.rule) list.rule = patch.rule;
    persist();
    return Promise.resolve(list);
  },
  setListItems: (listId: string, articleIds: string[]): Promise<void> => {
    state.listItems[listId] = [...new Set(articleIds)].filter((id) => byId.has(id));
    persist();
    return Promise.resolve();
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
  // Libby needs a server to hold the sign-in; the demo shows the unlinked state.
  getLibby: (): Promise<LibbyState> => Promise.resolve({ linked: false }),
  linkLibby: (_code: string): Promise<LibbyState> => readOnly(),
  unlinkLibby: (): Promise<void> => readOnly(),
  syncLibby: (): Promise<LibbyState> => readOnly(),
  searchLibby: (_query: string, _cardId?: string) => readOnly(),
  placeLibbyHold: (_cardId: string, _titleId: string): Promise<LibbyState> => readOnly(),
  cancelLibbyHold: (_cardId: string, _titleId: string): Promise<LibbyState> => readOnly(),
  suspendLibbyHold: (_cardId: string, _titleId: string, _days: number): Promise<LibbyState> => readOnly(),
  borrowLibbyHold: (_cardId: string, _titleId: string): Promise<LibbyState> => readOnly(),
  testIngestor: (): Promise<IngestorTestResult> => readOnly(),
};
