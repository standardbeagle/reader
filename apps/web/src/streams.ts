import { FEED_KINDS, type ArticleQueryParams, type Feed, type FeedKind } from "./api";
import { idFromRouteKey, routeKey } from "./urls";

/**
 * A stream is any slice of articles the app can show, page through and play:
 * everything, one feed, one list (a playlist), every feed in a category, or
 * every feed of a kind.
 */
export type Stream =
  | { kind: "all" }
  | { kind: "feed"; feedId: string }
  | { kind: "list"; listId: string }
  | { kind: "category"; category: string }
  | { kind: "type"; feedKind: FeedKind };

export const FEED_KIND_LABELS: Record<FeedKind, string> = {
  article: "Articles", podcast: "Podcasts", video: "Video", social: "Social", library: "Library",
};

/** Looks up the titles a stream's path and heading are built from. */
export interface StreamTitles {
  feed(id: string): string | null;
  list(id: string): string | null;
}

export function streamFromParams(params: { feedId?: string; listId?: string; feedCategory?: string; feedKind?: string }): Stream {
  if (params.listId) return { kind: "list", listId: idFromRouteKey(params.listId) };
  if (params.feedId) return { kind: "feed", feedId: idFromRouteKey(params.feedId) };
  if (params.feedCategory) return { kind: "category", category: params.feedCategory };
  const feedKind = FEED_KINDS.find((kind) => kind === params.feedKind);
  return feedKind ? { kind: "type", feedKind } : { kind: "all" };
}

/** Stable identity for query keys and equality. */
export function streamKey(stream: Stream): string {
  switch (stream.kind) {
    case "all": return "all";
    case "feed": return `feed:${stream.feedId}`;
    case "list": return `list:${stream.listId}`;
    case "category": return `category:${stream.category}`;
    case "type": return `type:${stream.feedKind}`;
  }
}

export function streamQuery(stream: Stream): ArticleQueryParams {
  switch (stream.kind) {
    case "all": return {};
    case "feed": return { feedId: stream.feedId };
    case "list": return { listId: stream.listId };
    case "category": return { feedCategory: stream.category };
    case "type": return { feedKind: stream.feedKind };
  }
}

export function streamPath(stream: Stream, titles: StreamTitles): string {
  switch (stream.kind) {
    case "all": return "/";
    case "feed": return `/feeds/${routeKey(titles.feed(stream.feedId) ?? "feed", stream.feedId)}`;
    case "list": return `/lists/${routeKey(titles.list(stream.listId) ?? "list", stream.listId)}`;
    case "category": return `/category/${encodeURIComponent(stream.category)}`;
    case "type": return `/type/${stream.feedKind}`;
  }
}

/**
 * Where an article lives while browsing a stream. Inside a list, category or
 * type the article stays under that stream so prev/next keep walking it;
 * from "all" or a feed it sits under its own feed.
 */
export function streamArticlePath(stream: Stream, article: { id: string; feedId: string; title: string }, titles: StreamTitles): string {
  const home: Stream = stream.kind === "all" || stream.kind === "feed" ? { kind: "feed", feedId: article.feedId } : stream;
  return `${streamPath(home, titles)}/articles/${routeKey(article.title, article.id)}`;
}

export function streamTitle(stream: Stream, titles: StreamTitles): string {
  switch (stream.kind) {
    case "all": return "All items";
    case "feed": return titles.feed(stream.feedId) ?? "Feed";
    case "list": return titles.list(stream.listId) ?? "List";
    case "category": return stream.category;
    case "type": return FEED_KIND_LABELS[stream.feedKind];
  }
}

export type FeedGrouping = "category" | "type" | "none";

export interface FeedGroup {
  key: string;
  label: string;
  /** Selecting the group's heading shows this stream; null for feeds with no category. */
  stream: Stream | null;
  feeds: Feed[];
  unreadCount: number;
}

/** Feeds arranged for the sidebar. Named categories come first, alphabetically; kinds keep a fixed order. */
export function groupFeeds(feeds: readonly Feed[], grouping: FeedGrouping): FeedGroup[] {
  if (grouping === "none") return [];
  const groups = new Map<string, FeedGroup>();
  for (const feed of feeds) {
    const key = grouping === "type" ? feed.kind : feed.category ?? "";
    let group = groups.get(key);
    if (!group) {
      group = grouping === "type"
        ? { key, label: FEED_KIND_LABELS[feed.kind], stream: { kind: "type", feedKind: feed.kind }, feeds: [], unreadCount: 0 }
        : { key, label: feed.category ?? "Uncategorized", stream: feed.category ? { kind: "category", category: feed.category } : null, feeds: [], unreadCount: 0 };
      groups.set(key, group);
    }
    group.feeds.push(feed);
    group.unreadCount += feed.unreadCount;
  }
  const rank = (group: FeedGroup) => grouping === "type" ? FEED_KINDS.indexOf(group.key as FeedKind) : group.stream ? 0 : 1;
  return [...groups.values()].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}
