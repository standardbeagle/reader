import type { Article } from "./api";

/**
 * Neighbor target for prev/next article navigation. With `unreadOnly`, the
 * nearest unread article in that direction; otherwise the immediate neighbor.
 * Returns null when nothing in that direction qualifies (e.g. the remaining
 * unread articles sit in pages not loaded yet).
 */
export function navNeighbor(
  list: readonly Article[],
  currentIndex: number,
  dir: "prev" | "next",
  unreadOnly: boolean,
): Article | null {
  if (currentIndex < 0 || list.length === 0) return null;
  const step = dir === "next" ? 1 : -1;
  if (!unreadOnly) return list[currentIndex + step] ?? null;
  for (let i = currentIndex + step; i >= 0 && i < list.length; i += step) {
    const candidate = list[i];
    if (candidate && !candidate.readAt) return candidate;
  }
  return null;
}
