import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value); },
  removeItem: (key: string) => { store.delete(key); },
});

// The module caches its snapshot, so each test gets a fresh import.
async function loadModule() {
  vi.resetModules();
  return await import("./listShortcuts");
}

beforeEach(() => store.clear());

describe("listShortcuts", () => {
  it("binds a key to a list and resolves it back", async () => {
    const m = await loadModule();
    expect(m.setListShortcut("list-1", "1")).toBeNull();
    expect(m.listIdForKey("1")).toBe("list-1");
    expect(m.listIdForKey("2")).toBeNull();
  });

  it("rejects reserved built-in keys", async () => {
    const m = await loadModule();
    expect(m.setListShortcut("list-1", "j")).toMatch(/built-in/);
    expect(m.setListShortcut("list-1", "?")).toMatch(/built-in/);
    expect(m.listIdForKey("j")).toBeNull();
  });

  it("rejects multi-character bindings", async () => {
    const m = await loadModule();
    expect(m.setListShortcut("list-1", "ab")).toMatch(/single key/);
  });

  it("steals a key from the list that already holds it", async () => {
    const m = await loadModule();
    expect(m.setListShortcut("list-1", "1")).toBeNull();
    expect(m.setListShortcut("list-2", "1")).toBeNull();
    expect(m.listIdForKey("1")).toBe("list-2");
  });

  it("clears a binding with null", async () => {
    const m = await loadModule();
    expect(m.setListShortcut("list-1", "1")).toBeNull();
    expect(m.setListShortcut("list-1", null)).toBeNull();
    expect(m.listIdForKey("1")).toBeNull();
  });

  it("ignores corrupt stored data", async () => {
    store.set("reader-list-shortcuts-v1", "{not json");
    const m = await loadModule();
    expect(m.listIdForKey("1")).toBeNull();
  });
});
