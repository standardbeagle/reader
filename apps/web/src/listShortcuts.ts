import { useSyncExternalStore } from "react";

// Keys owned by the app-level keyboard handler; binding one to a list would
// shadow the built-in action.
export const RESERVED_SHORTCUT_KEYS = new Set(["j", "k", "r", "o", "s", "t", "w", "u", "[", "]", "?", "Escape"]);

const STORAGE_KEY = "reader-list-shortcuts-v1";

/** listId → single-character key. */
let snapshot: Record<string, string> | null = null;
const listeners = new Set<() => void>();

function load(): Record<string, string> {
  if (snapshot) return snapshot;
  const map: Record<string, string> = {};
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [listId, key] of Object.entries(parsed)) {
        if (typeof key === "string" && key.length === 1) map[listId] = key;
      }
    }
  } catch {
    // Corrupt storage: start empty rather than breaking the app.
  }
  snapshot = map;
  return map;
}

export function listIdForKey(key: string): string | null {
  for (const [listId, bound] of Object.entries(load())) {
    if (bound === key) return listId;
  }
  return null;
}

/** Bind or clear a list shortcut. Returns an error message, or null on success. */
export function setListShortcut(listId: string, key: string | null): string | null {
  if (key !== null) {
    if (key.length !== 1) return "Use a single key.";
    if (RESERVED_SHORTCUT_KEYS.has(key)) return `"${key}" is already used by a built-in shortcut.`;
  }
  const next = { ...load() };
  delete next[listId];
  if (key !== null) {
    // One list per key: steal the key from any list that already holds it.
    for (const [id, bound] of Object.entries(next)) if (bound === key) delete next[id];
    next[listId] = key;
  }
  snapshot = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    return "Could not save the shortcut.";
  }
  for (const notify of listeners) notify();
  return null;
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => { listeners.delete(notify); };
}

export function useListShortcuts(): Record<string, string> {
  return useSyncExternalStore(subscribe, load);
}

// Keep hook instances and tabs in sync when storage changes elsewhere.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    snapshot = null;
    load();
    for (const notify of listeners) notify();
  });
}
