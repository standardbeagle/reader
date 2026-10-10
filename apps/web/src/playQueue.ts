import { useSyncExternalStore } from "react";
import type { Article } from "./api";
import { youtubeVideo } from "./youtube";

// The play queue outlives navigation: it belongs to the app, not to the
// article on screen, and is kept in localStorage so a reload resumes it.

/** What the player needs from an article; kept small because the queue is persisted. */
export interface QueueItem {
  id: string;
  feedId: string;
  title: string;
  url: string | null;
  media: { url: string; type: string | null } | null;
  imageUrl: string | null;
}

export interface PlayQueue {
  items: QueueItem[];
  /** The item in the player; -1 when nothing is loaded. */
  index: number;
  /** Seconds into the current item, saved as it plays so a reload resumes there. */
  position: number;
  /** Where the queue came from, when it was started from a stream. */
  source: string | null;
}

export const EMPTY_QUEUE: PlayQueue = { items: [], index: -1, position: 0, source: null };

/** Audio, video, or a YouTube link: something the player can play. */
export function isPlayable(article: { url: string | null; media?: { url: string } | null }): boolean {
  return Boolean(article.media?.url) || youtubeVideo(article.url) !== null;
}

export function queueItem(article: Article): QueueItem {
  return { id: article.id, feedId: article.feedId, title: article.title, url: article.url, media: article.media ?? null, imageUrl: article.imageUrl ?? null };
}

export function currentItem(queue: PlayQueue): QueueItem | null {
  return queue.items[queue.index] ?? null;
}

/** Play an item now. One already queued is jumped to; a new one goes in right after the current item. */
export function playNow(queue: PlayQueue, item: QueueItem, position = 0): PlayQueue {
  const existing = queue.items.findIndex((queued) => queued.id === item.id);
  if (existing >= 0) return { ...queue, index: existing, position };
  const at = queue.index + 1;
  // With an outside item spliced in, the queue is no longer just the stream it started from.
  return { items: [...queue.items.slice(0, at), item, ...queue.items.slice(at)], index: at, position, source: null };
}

/** Add to the end. A queue with nothing loaded starts on the new item. */
export function enqueue(queue: PlayQueue, item: QueueItem): PlayQueue {
  if (queue.items.some((queued) => queued.id === item.id)) return queue;
  return { ...queue, items: [...queue.items, item], index: queue.index < 0 ? 0 : queue.index };
}

/** Replace the queue with a stream's playable items, starting at `startId` or the top. */
export function playAll(items: QueueItem[], source: string, startId?: string): PlayQueue {
  if (items.length === 0) return EMPTY_QUEUE;
  return { items, index: Math.max(0, items.findIndex((item) => item.id === startId)), position: 0, source };
}

/** Move to the next or previous item; null when there is none in that direction. */
export function step(queue: PlayQueue, by: 1 | -1): PlayQueue | null {
  const index = queue.index + by;
  return index >= 0 && index < queue.items.length ? { ...queue, index, position: 0 } : null;
}

export function jumpTo(queue: PlayQueue, index: number): PlayQueue {
  return index >= 0 && index < queue.items.length ? { ...queue, index, position: 0 } : queue;
}

/** Drop an item. Removing the current one loads whatever takes its place. */
export function removeAt(queue: PlayQueue, index: number): PlayQueue {
  if (index < 0 || index >= queue.items.length) return queue;
  const items = queue.items.filter((_, i) => i !== index);
  if (items.length === 0) return EMPTY_QUEUE;
  if (index < queue.index) return { ...queue, items, index: queue.index - 1 };
  if (index > queue.index) return { ...queue, items };
  return { ...queue, items, index: Math.min(index, items.length - 1), position: 0 };
}

const STORAGE_KEY = "reader.playQueue.v1";
let snapshot: PlayQueue | null = null;
const listeners = new Set<() => void>();

function load(): PlayQueue {
  if (snapshot) return snapshot;
  snapshot = EMPTY_QUEUE;
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as PlayQueue | null;
    if (parsed && Array.isArray(parsed.items) && typeof parsed.index === "number" && parsed.index < parsed.items.length) {
      snapshot = { items: parsed.items, index: parsed.index, position: Number(parsed.position) || 0, source: parsed.source ?? null };
    }
  } catch {
    // Corrupt storage: start with an empty queue rather than breaking the app.
  }
  return snapshot;
}

function save(next: PlayQueue, notify: boolean): void {
  snapshot = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // A full or blocked store only costs the resume-after-reload; playback goes on.
  }
  if (notify) for (const listener of listeners) listener();
}

// Counts the changes that should start playback: a different item in the
// player, or the same one sent to a new position. It starts at zero on load,
// which is how the player tells "resume this after a reload" (stay paused)
// from "the user just asked for this" (play).
let playRequests = 0;

export function playRequestCount(): number {
  return playRequests;
}

/** Apply a queue transition. A transition that returns null (nothing to do) is ignored. */
export function updateQueue(change: (queue: PlayQueue) => PlayQueue | null): void {
  const previous = load();
  const next = change(previous);
  if (!next || next === previous) return;
  if (currentItem(next) && (currentItem(next)!.id !== currentItem(previous)?.id || next.position !== previous.position)) playRequests += 1;
  save(next, true);
}

/**
 * Record how far the current item has played. Deliberately silent: the
 * player reports this every few seconds and nothing on screen depends on it.
 */
export function savePosition(itemId: string, seconds: number): void {
  const queue = load();
  if (currentItem(queue)?.id === itemId) save({ ...queue, position: seconds }, false);
}

export function usePlayQueue(): PlayQueue {
  return useSyncExternalStore((notify) => {
    listeners.add(notify);
    return () => { listeners.delete(notify); };
  }, load);
}

// The player element lives in the dock; chapter and transcript links in an
// article reach it through here.
let seekPlayer: ((seconds: number) => void) | null = null;

export function registerSeek(seek: ((seconds: number) => void) | null): void {
  seekPlayer = seek;
}

/** Play `article` from `seconds`: seeks in place when it is already in the player. */
export function playFrom(article: Article, seconds: number): void {
  if (currentItem(load())?.id === article.id && seekPlayer) seekPlayer(seconds);
  else updateQueue((queue) => playNow(queue, queueItem(article), seconds));
}
