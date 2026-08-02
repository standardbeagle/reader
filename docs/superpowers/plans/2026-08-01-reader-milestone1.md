# Reader Clone — Milestone 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working feed reader core — feed parsing, storage, background polling, minimal HTTP API, minimal three-pane web UI, and an Electron shell that runs it locally.

**Architecture:** pnpm monorepo. `packages/core` (pure parsing/sanitizing/types, no I/O), `packages/server` (Fastify + better-sqlite3 + poller), `apps/web` (React+Vite+TanStack Query), `apps/desktop` (Electron shell forking the server on 127.0.0.1). Local single-user mode only in M1; hosted auth/PG come in milestone 4.

**Tech Stack:** TypeScript, Node 22+, pnpm workspaces, Vitest, Fastify 5, better-sqlite3, rss-parser, DOMPurify+jsdom, p-limit, React 19, Vite, TanStack Query, Electron, tsx (dev runner).

**Reference:** Spec at `docs/superpowers/specs/2026-08-01-reader-clone-design.md`. M1 covers spec sections 1–5 minus folders/star/search/OPML/full-text extraction (later milestones).

**Conventions:**
- All test/build commands run via `tman run -- <cmd>`.
- Package names: `@reader/core`, `@reader/server`, `@reader/web`, `@reader/desktop`.
- IDs are `crypto.randomUUID()` strings. Dates stored as ISO 8601 strings in SQLite.
- Commits: conventional format, one task = one or more atomic commits as marked.

---

### Task 1: Repo scaffold

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`
- Create: `packages/server/package.json`, `packages/server/tsconfig.json`
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`
- Create: `apps/desktop/package.json`

- [ ] **Step 1: Write workspace root files**

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
  - "apps/*"
```

`package.json`:
```json
{
  "name": "reader",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "dev:server": "pnpm --filter @reader/server dev",
    "dev:web": "pnpm --filter @reader/web dev",
    "dev:desktop": "pnpm --filter @reader/desktop dev"
  },
  "devDependencies": {
    "typescript": "^5.9.0"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "outDir": "dist",
    "skipLibCheck": true
  }
}
```

`.gitignore`:
```
node_modules/
dist/
*.log
.env
apps/desktop/out/
```

`packages/core/package.json`:
```json
{
  "name": "@reader/core",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "build": "tsc -p tsconfig.json" },
  "dependencies": {
    "rss-parser": "^3.13.0",
    "dompurify": "^3.2.4",
    "jsdom": "^26.0.0"
  },
  "devDependencies": { "typescript": "^5.9.0", "vitest": "^3.0.0" }
}
```

`packages/core/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`packages/server/package.json`:
```json
{
  "name": "@reader/server",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "build": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@reader/core": "workspace:*",
    "fastify": "^5.2.0",
    "better-sqlite3": "^12.0.0",
    "p-limit": "^7.0.0"
  },
  "devDependencies": {
    "typescript": "^5.9.0",
    "vitest": "^3.0.0",
    "tsx": "^4.19.0",
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^22.0.0"
  }
}
```

`packages/server/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`apps/web/package.json`:
```json
{
  "name": "@reader/web",
  "version": "0.1.0",
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build", "test": "vitest run" },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router": "^7.1.0",
    "@tanstack/react-query": "^5.62.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.0",
    "vite": "^7.0.0",
    "typescript": "^5.9.0",
    "vitest": "^3.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0"
  }
}
```

`apps/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "module": "ESNext", "moduleResolution": "Bundler", "jsx": "react-jsx", "lib": ["ES2023", "DOM", "DOM.Iterable"], "noEmit": true },
  "include": ["src", "index.html"]
}
```

`apps/desktop/package.json`:
```json
{
  "name": "@reader/desktop",
  "version": "0.1.0",
  "type": "module",
  "scripts": { "dev": "tsx src/main.ts", "build": "tsc -p tsconfig.json" },
  "dependencies": { "electron": "^33.0.0" },
  "devDependencies": { "typescript": "^5.9.0", "tsx": "^4.19.0", "@types/node": "^22.0.0" }
}
```

- [ ] **Step 2: Install and verify**

Run: `pnpm install`
Expected: all workspaces resolve, no errors.

Run: `tman run -- pnpm -r build`
Expected: core and server compile empty (no src yet — tsc errors on missing inputs are acceptable; fix by adding `src/index.ts` placeholder with `export {}` in each package).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm monorepo workspaces"
```

---

### Task 2: `core` shared types + feed parser

**Files:**
- Create: `packages/core/src/types.ts`
- Create: `packages/core/src/parse.ts`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/test/fixtures/rss2.xml`
- Create: `packages/core/test/fixtures/atom.xml`
- Create: `packages/core/test/fixtures/no-guid.xml`
- Create: `packages/core/test/parse.test.ts`

- [ ] **Step 1: Write types**

`packages/core/src/types.ts`:
```ts
export interface ParsedArticle {
  guid: string;
  url: string | null;
  title: string;
  author: string | null;
  publishedAt: Date | null;
  contentHtml: string | null;
  summary: string | null;
}

export interface ParsedFeed {
  title: string;
  siteUrl: string | null;
  articles: ParsedArticle[];
}
```

- [ ] **Step 2: Write the failing test**

`packages/core/test/parse.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFeed } from "../src/parse.js";

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");

describe("parseFeed", () => {
  it("parses RSS 2.0 with title, site url and items", async () => {
    const feed = await parseFeed(fixture("rss2.xml"));
    expect(feed.title).toBe("Example Blog");
    expect(feed.siteUrl).toBe("https://example.com");
    expect(feed.articles).toHaveLength(2);
    const first = feed.articles[0]!;
    expect(first.guid).toBe("urn:uuid:1");
    expect(first.title).toBe("First Post");
    expect(first.url).toBe("https://example.com/first");
    expect(first.publishedAt?.toISOString()).toBe("2026-07-01T12:00:00.000Z");
    expect(first.contentHtml).toContain("<p>Hello world</p>");
  });

  it("parses Atom feeds", async () => {
    const feed = await parseFeed(fixture("atom.xml"));
    expect(feed.title).toBe("Atom Blog");
    expect(feed.articles).toHaveLength(1);
    expect(feed.articles[0]!.guid).toBe("tag:example.com,2026:1");
  });

  it("synthesizes a stable guid when missing", async () => {
    const a = await parseFeed(fixture("no-guid.xml"));
    const b = await parseFeed(fixture("no-guid.xml"));
    expect(a.articles[0]!.guid).toBe(b.articles[0]!.guid);
    expect(a.articles[0]!.guid).toMatch(/^sha1:[0-9a-f]{40}$/);
  });

  it("tolerates missing dates and authors", async () => {
    const feed = await parseFeed(fixture("no-guid.xml"));
    expect(feed.articles[0]!.publishedAt).toBeNull();
    expect(feed.articles[0]!.author).toBeNull();
  });
});
```

- [ ] **Step 3: Write fixtures**

`packages/core/test/fixtures/rss2.xml`:
```xml
<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Example Blog</title>
    <link>https://example.com</link>
    <description>An example</description>
    <item>
      <title>First Post</title>
      <link>https://example.com/first</link>
      <guid>urn:uuid:1</guid>
      <pubDate>Wed, 01 Jul 2026 12:00:00 GMT</pubDate>
      <description>&lt;p&gt;Hello world&lt;/p&gt;</description>
    </item>
    <item>
      <title>Second Post</title>
      <link>https://example.com/second</link>
      <guid>urn:uuid:2</guid>
      <pubDate>Thu, 02 Jul 2026 12:00:00 GMT</pubDate>
      <description>&lt;p&gt;Again&lt;/p&gt;</description>
    </item>
  </channel>
</rss>
```

`packages/core/test/fixtures/atom.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Blog</title>
  <link href="https://atom.example.com"/>
  <updated>2026-07-01T12:00:00Z</updated>
  <entry>
    <title>Atom Post</title>
    <link href="https://atom.example.com/1"/>
    <id>tag:example.com,2026:1</id>
    <updated>2026-07-01T12:00:00Z</updated>
    <content type="html">&lt;p&gt;Atom content&lt;/p&gt;</content>
  </entry>
</feed>
```

`packages/core/test/fixtures/no-guid.xml`:
```xml
<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>No GUID Blog</title>
    <link>https://noguid.example.com</link>
    <item>
      <title>Undated Post</title>
      <link>https://noguid.example.com/a</link>
      <description>text only</description>
    </item>
  </channel>
</rss>
```

- [ ] **Step 4: Run test to verify it fails**

Run: `tman run -- pnpm --filter @reader/core test`
Expected: FAIL — `../src/parse.js` does not exist.

- [ ] **Step 5: Implement parser**

`packages/core/src/parse.ts`:
```ts
import Parser from "rss-parser";
import { createHash } from "node:crypto";
import type { ParsedFeed, ParsedArticle } from "./types.js";

const parser = new Parser();

export async function parseFeed(xml: string): Promise<ParsedFeed> {
  const raw = await parser.parseString(xml);
  const articles: ParsedArticle[] = (raw.items ?? []).map((item) => {
    const it = item as Parser.Item & { id?: string };
    const title = it.title?.trim() || "(untitled)";
    const url = it.link ?? null;
    const published = it.isoDate ?? it.pubDate ?? null;
    const parsedDate = published ? new Date(published) : null;
    const explicitGuid = it.guid ?? it.id ?? null;
    const guid = explicitGuid
      ?? `sha1:${createHash("sha1").update(url ?? `${title}|${published ?? ""}`).digest("hex")}`;
    return {
      guid,
      url,
      title,
      author: it.creator ?? it.author ?? null,
      publishedAt: parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate : null,
      contentHtml: (it["content:encoded"] as string | undefined) ?? it.content ?? null,
      summary: it.summary ?? it.contentSnippet ?? null,
    };
  });
  return {
    title: raw.title?.trim() || "(untitled feed)",
    siteUrl: raw.link ?? null,
    articles,
  };
}
```

Note for implementer: `parseFeed` is async — rss-parser's `parseString` resolves in a microtask even for string input, so no sync wrapper is possible.

`packages/core/src/index.ts`:
```ts
export type { ParsedArticle, ParsedFeed } from "./types.js";
export { parseFeed } from "./parse.js";
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `tman run -- pnpm --filter @reader/core test`
Expected: 4 tests PASS. If rss-parser's types don't expose `id`, use `(item as Record<string, unknown>).id` with a narrow.

- [ ] **Step 7: Commit**

```bash
git add packages/core
git commit -m "feat(core): add feed parser with guid synthesis for RSS/Atom"
```

---

### Task 3: `core` HTML sanitizer

**Files:**
- Create: `packages/core/src/sanitize.ts`
- Create: `packages/core/test/sanitize.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/test/sanitize.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { sanitizeHtml } from "../src/sanitize.js";

describe("sanitizeHtml", () => {
  it("strips script tags and event handlers", () => {
    const out = sanitizeHtml('<p onclick="x()">hi</p><script>alert(1)</script>');
    expect(out).toBe("<p>hi</p>");
  });

  it("strips javascript: URLs", () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain("javascript:");
  });

  it("keeps safe article markup", () => {
    const input = '<h2>T</h2><p>para <b>bold</b> <a href="https://x.com">l</a></p><img src="https://x.com/a.png" alt="a">';
    const out = sanitizeHtml(input);
    expect(out).toContain("<h2>");
    expect(out).toContain('<a href="https://x.com">');
    expect(out).toContain('src="https://x.com/a.png"');
  });

  it("forces external links to rel=noopener and target=_blank", () => {
    const out = sanitizeHtml('<a href="https://x.com">l</a>');
    expect(out).toContain('rel="noopener"');
    expect(out).toContain('target="_blank"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `tman run -- pnpm --filter @reader/core test`
Expected: FAIL — `../src/sanitize.js` does not exist.

- [ ] **Step 3: Implement sanitizer**

`packages/core/src/sanitize.ts`:
```ts
import { JSDOM } from "jsdom";
import createDOMPurify from "dompurify";

const window = new JSDOM("").window;
const DOMPurify = createDOMPurify(window as unknown as Window);

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
  if (node.tagName === "IMG") {
    node.setAttribute("loading", "lazy");
    node.setAttribute("referrerpolicy", "no-referrer");
  }
});

export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: [
      "a", "abbr", "b", "blockquote", "br", "code", "dd", "del", "div", "dl",
      "dt", "em", "figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6",
      "hr", "i", "img", "li", "ol", "p", "pre", "q", "s", "small", "span",
      "strong", "sub", "sup", "table", "tbody", "td", "th", "thead", "tr",
      "u", "ul",
    ],
    ALLOWED_ATTR: ["href", "src", "alt", "title", "class"],
  });
}
```

Export from `packages/core/src/index.ts`:
```ts
export { sanitizeHtml } from "./sanitize.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `tman run -- pnpm --filter @reader/core test`
Expected: all tests PASS (7 total). Note: DOMPurify returns attributes in a normalized order; if the `keeps safe article markup` assertion on exact attribute order fails, assert with `toContain('href="https://x.com"')` only.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): add DOMPurify HTML sanitizer with safe allowlist"
```

---

### Task 4: `server` storage — schema, migrations, SQLite adapter

**Files:**
- Create: `packages/server/src/storage/types.ts`
- Create: `packages/server/src/storage/migrations/0001_init.sql`
- Create: `packages/server/src/storage/sqlite.ts`
- Create: `packages/server/src/storage/index.ts`
- Create: `packages/server/test/storage.test.ts`

- [ ] **Step 1: Define storage types**

`packages/server/src/storage/types.ts`:
```ts
import type { ParsedArticle } from "@reader/core";

export interface User { id: string; email: string | null; createdAt: string; }

export interface Feed {
  id: string;
  userId: string;
  url: string;
  title: string;
  siteUrl: string | null;
  etag: string | null;
  lastModified: string | null;
  lastFetchedAt: string | null;
  fetchIntervalMin: number;
  errorCount: number;
  status: "ok" | "broken";
  createdAt: string;
}

export interface Article {
  id: string;
  feedId: string;
  guid: string;
  url: string | null;
  title: string;
  author: string | null;
  publishedAt: string | null;
  contentHtml: string | null;
  summary: string | null;
  fetchedAt: string;
}

export interface ArticleWithState extends Article {
  readAt: string | null;
}

export interface ArticleQuery {
  userId: string;
  feedId?: string;
  unreadOnly?: boolean;
  before?: string; // ISO date cursor on published_at
  limit: number;
}

export interface FetchState {
  etag?: string | null;
  lastModified?: string | null;
  lastFetchedAt: string;
  fetchIntervalMin: number;
  errorCount: number;
  status: "ok" | "broken";
  title?: string;
  siteUrl?: string | null;
}

export interface Storage {
  close(): void;
  getOrCreateLocalUser(): User;
  createFeed(userId: string, input: { url: string; title: string; siteUrl: string | null }): Feed;
  listFeeds(userId: string): Feed[];
  getFeed(id: string): Feed | null;
  deleteFeed(id: string): void;
  dueFeeds(now: Date): Feed[];
  updateFeedFetchState(id: string, state: FetchState): void;
  upsertArticles(feedId: string, articles: ParsedArticle[], sanitize: (html: string) => string): Article[];
  listArticles(q: ArticleQuery): ArticleWithState[];
  setRead(userId: string, articleId: string, read: boolean): void;
  markAllRead(userId: string, feedId: string): void;
  unreadCounts(userId: string): Record<string, number>;
}
```

- [ ] **Step 2: Write migration**

`packages/server/src/storage/migrations/0001_init.sql`:
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  password_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE feeds (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  site_url TEXT,
  etag TEXT,
  last_modified TEXT,
  last_fetched_at TEXT,
  fetch_interval_min INTEGER NOT NULL DEFAULT 60,
  error_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok',
  created_at TEXT NOT NULL,
  UNIQUE (user_id, url)
);

CREATE TABLE articles (
  id TEXT PRIMARY KEY,
  feed_id TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  guid TEXT NOT NULL,
  url TEXT,
  title TEXT NOT NULL,
  author TEXT,
  published_at TEXT,
  content_html TEXT,
  summary TEXT,
  fetched_at TEXT NOT NULL,
  UNIQUE (feed_id, guid)
);

CREATE TABLE user_articles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  read_at TEXT,
  starred_at TEXT,
  PRIMARY KEY (user_id, article_id)
);

CREATE INDEX idx_articles_feed_published ON articles(feed_id, published_at DESC);
CREATE INDEX idx_user_articles_read ON user_articles(user_id, read_at);
```

- [ ] **Step 3: Write the failing test**

`packages/server/test/storage.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createSqliteStorage } from "../src/storage/sqlite.js";
import type { Storage } from "../src/storage/types.js";

let storage: Storage;
let userId: string;
const identity = (html: string) => html;

beforeEach(() => {
  storage = createSqliteStorage(":memory:");
  userId = storage.getOrCreateLocalUser().id;
});
afterEach(() => storage.close());

function makeFeed(url = "https://a.example.com/feed.xml") {
  return storage.createFeed(userId, { url, title: "A", siteUrl: null });
}

describe("sqlite storage", () => {
  it("creates and retrieves the local user idempotently", () => {
    const a = storage.getOrCreateLocalUser();
    const b = storage.getOrCreateLocalUser();
    expect(a.id).toBe(b.id);
  });

  it("rejects duplicate feed urls for the same user", () => {
    makeFeed();
    expect(() => makeFeed()).toThrow(/UNIQUE/);
  });

  it("upserts articles and dedupes by guid", () => {
    const feed = makeFeed();
    const arts = [
      { guid: "g1", url: null, title: "T1", author: null, publishedAt: null, contentHtml: "<p>x</p>", summary: null },
      { guid: "g2", url: null, title: "T2", author: null, publishedAt: null, contentHtml: null, summary: "s" },
    ];
    const inserted1 = storage.upsertArticles(feed.id, arts, identity);
    const inserted2 = storage.upsertArticles(feed.id, arts, identity);
    expect(inserted1).toHaveLength(2);
    expect(inserted2).toHaveLength(0);
    expect(storage.listArticles({ userId, limit: 50 })).toHaveLength(2);
  });

  it("tracks read state per user", () => {
    const feed = makeFeed();
    const [a] = storage.upsertArticles(feed.id, [
      { guid: "g1", url: null, title: "T1", author: null, publishedAt: null, contentHtml: null, summary: null },
    ], identity);
    expect(storage.unreadCounts(userId)[feed.id]).toBe(1);
    storage.setRead(userId, a!.id, true);
    expect(storage.unreadCounts(userId)[feed.id]).toBeUndefined();
    const listed = storage.listArticles({ userId, limit: 50 });
    expect(listed[0]!.readAt).not.toBeNull();
    storage.setRead(userId, a!.id, false);
    expect(storage.unreadCounts(userId)[feed.id]).toBe(1);
  });

  it("filters unreadOnly and by feed, orders newest first", () => {
    const f1 = makeFeed("https://1.example.com/f");
    const f2 = makeFeed("https://2.example.com/f");
    storage.upsertArticles(f1.id, [
      { guid: "old", url: null, title: "Old", author: null, publishedAt: new Date("2026-01-01"), contentHtml: null, summary: null },
      { guid: "new", url: null, title: "New", author: null, publishedAt: new Date("2026-07-01"), contentHtml: null, summary: null },
    ], identity);
    storage.upsertArticles(f2.id, [
      { guid: "other", url: null, title: "Other", author: null, publishedAt: new Date("2026-06-01"), contentHtml: null, summary: null },
    ], identity);
    const all = storage.listArticles({ userId, limit: 50 });
    expect(all.map((a) => a.title)).toEqual(["New", "Other", "Old"]);
    expect(storage.listArticles({ userId, feedId: f2.id, limit: 50 })).toHaveLength(1);
    const [first] = storage.listArticles({ userId, limit: 1 });
    storage.setRead(userId, first!.id, true);
    const unread = storage.listArticles({ userId, unreadOnly: true, limit: 50 });
    expect(unread.map((a) => a.title)).toEqual(["Other", "Old"]);
  });

  it("dueFeeds respects interval and skips broken feeds", () => {
    const feed = makeFeed();
    const past = new Date(Date.now() - 2 * 3600_000);
    storage.updateFeedFetchState(feed.id, {
      lastFetchedAt: past.toISOString(), fetchIntervalMin: 60, errorCount: 0, status: "ok",
    });
    expect(storage.dueFeeds(new Date()).map((f) => f.id)).toContain(feed.id);
    storage.updateFeedFetchState(feed.id, {
      lastFetchedAt: new Date().toISOString(), fetchIntervalMin: 60, errorCount: 0, status: "ok",
    });
    expect(storage.dueFeeds(new Date()).map((f) => f.id)).not.toContain(feed.id);
    storage.updateFeedFetchState(feed.id, {
      lastFetchedAt: past.toISOString(), fetchIntervalMin: 60, errorCount: 10, status: "broken",
    });
    expect(storage.dueFeeds(new Date()).map((f) => f.id)).not.toContain(feed.id);
  });

  it("markAllRead marks every article in a feed", () => {
    const feed = makeFeed();
    storage.upsertArticles(feed.id, [
      { guid: "a", url: null, title: "A", author: null, publishedAt: null, contentHtml: null, summary: null },
      { guid: "b", url: null, title: "B", author: null, publishedAt: null, contentHtml: null, summary: null },
    ], identity);
    storage.markAllRead(userId, feed.id);
    expect(storage.unreadCounts(userId)[feed.id]).toBeUndefined();
  });

  it("deleteFeed cascades articles", () => {
    const feed = makeFeed();
    storage.upsertArticles(feed.id, [
      { guid: "a", url: null, title: "A", author: null, publishedAt: null, contentHtml: null, summary: null },
    ], identity);
    storage.deleteFeed(feed.id);
    expect(storage.listArticles({ userId, limit: 50 })).toHaveLength(0);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `tman run -- pnpm --filter @reader/server test`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement SQLite storage**

`packages/server/src/storage/sqlite.ts`:
```ts
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Storage, User, Feed, Article, ArticleWithState, ArticleQuery, FetchState,
} from "./types.js";
import type { ParsedArticle } from "@reader/core";

const LOCAL_USER_EMAIL = "local@reader";

export function createSqliteStorage(path: string): Storage {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);

  const insertUserArticleIfNew = db.prepare(`
    INSERT INTO user_articles (user_id, article_id, read_at, starred_at)
    SELECT ?, ?, NULL, NULL
    WHERE NOT EXISTS (
      SELECT 1 FROM user_articles WHERE user_id = ? AND article_id = ?
    )
  `);

  function migrate(d: Database.Database) {
    const dir = join(import.meta.dirname, "migrations");
    d.exec(readFileSync(join(dir, "0001_init.sql"), "utf8"));
  }

  function rowToFeed(r: Record<string, unknown>): Feed {
    return {
      id: r.id as string, userId: r.user_id as string, url: r.url as string,
      title: r.title as string, siteUrl: (r.site_url as string) ?? null,
      etag: (r.etag as string) ?? null,
      lastModified: (r.last_modified as string) ?? null,
      lastFetchedAt: (r.last_fetched_at as string) ?? null,
      fetchIntervalMin: r.fetch_interval_min as number,
      errorCount: r.error_count as number,
      status: r.status as "ok" | "broken",
      createdAt: r.created_at as string,
    };
  }

  function rowToArticle(r: Record<string, unknown>): Article {
    return {
      id: r.id as string, feedId: r.feed_id as string, guid: r.guid as string,
      url: (r.url as string) ?? null, title: r.title as string,
      author: (r.author as string) ?? null,
      publishedAt: (r.published_at as string) ?? null,
      contentHtml: (r.content_html as string) ?? null,
      summary: (r.summary as string) ?? null,
      fetchedAt: r.fetched_at as string,
    };
  }

  return {
    close() { db.close(); },

    getOrCreateLocalUser(): User {
      const existing = db.prepare("SELECT * FROM users WHERE email = ?").get(LOCAL_USER_EMAIL) as Record<string, unknown> | undefined;
      if (existing) return { id: existing.id as string, email: existing.email as string, createdAt: existing.created_at as string };
      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, NULL, ?)").run(id, LOCAL_USER_EMAIL, now);
      return { id, email: LOCAL_USER_EMAIL, createdAt: now };
    },

    createFeed(userId, input): Feed {
      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO feeds (id, user_id, url, title, site_url, created_at)
                  VALUES (?, ?, ?, ?, ?, ?)`).run(id, userId, input.url, input.title, input.siteUrl, now);
      return this.getFeed(id)!;
    },

    listFeeds(userId): Feed[] {
      const rows = db.prepare("SELECT * FROM feeds WHERE user_id = ? ORDER BY title").all(userId) as Record<string, unknown>[];
      return rows.map(rowToFeed);
    },

    getFeed(id): Feed | null {
      const r = db.prepare("SELECT * FROM feeds WHERE id = ?").get(id) as Record<string, unknown> | undefined;
      return r ? rowToFeed(r) : null;
    },

    deleteFeed(id) { db.prepare("DELETE FROM feeds WHERE id = ?").run(id); },

    dueFeeds(now): Feed[] {
      // julianday handles ISO strings with 'T'/'Z'; string comparison against
      // datetime() output (space separator) would misorder.
      const rows = db.prepare(`
        SELECT * FROM feeds
        WHERE status = 'ok'
          AND (last_fetched_at IS NULL
               OR julianday(last_fetched_at) <= julianday(?) - fetch_interval_min / 1440.0)
      `).all(now.toISOString()) as Record<string, unknown>[];
      return rows.map(rowToFeed);
    },

    updateFeedFetchState(id, state: FetchState) {
      db.prepare(`
        UPDATE feeds SET
          etag = COALESCE(?, etag),
          last_modified = COALESCE(?, last_modified),
          last_fetched_at = ?,
          fetch_interval_min = ?,
          error_count = ?,
          status = ?,
          title = COALESCE(?, title),
          site_url = COALESCE(?, site_url)
        WHERE id = ?
      `).run(
        state.etag ?? null, state.lastModified ?? null, state.lastFetchedAt,
        state.fetchIntervalMin, state.errorCount, state.status,
        state.title ?? null, state.siteUrl ?? null, id,
      );
    },

    upsertArticles(feedId, articles: ParsedArticle[], sanitize): Article[] {
      const insert = db.prepare(`
        INSERT INTO articles (id, feed_id, guid, url, title, author, published_at, content_html, summary, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (feed_id, guid) DO NOTHING
      `);
      const findUser = db.prepare("SELECT user_id FROM feeds WHERE id = ?");
      const userId = (findUser.get(feedId) as { user_id: string }).user_id;
      const inserted: Article[] = [];
      const tx = db.transaction(() => {
        for (const a of articles) {
          const id = randomUUID();
          const now = new Date().toISOString();
          const res = insert.run(
            id, feedId, a.guid, a.url, a.title, a.author,
            a.publishedAt ? a.publishedAt.toISOString() : null,
            a.contentHtml ? sanitize(a.contentHtml) : null,
            a.summary, now,
          );
          if (res.changes > 0) {
            insertUserArticleIfNew.run(userId, id, userId, id);
            inserted.push({
              id, feedId, guid: a.guid, url: a.url, title: a.title, author: a.author,
              publishedAt: a.publishedAt ? a.publishedAt.toISOString() : null,
              contentHtml: a.contentHtml, summary: a.summary, fetchedAt: now,
            });
          }
        }
      });
      tx();
      return inserted;
    },

    listArticles(q: ArticleQuery): ArticleWithState[] {
      const clauses = ["f.user_id = ?"];
      const params: unknown[] = [q.userId];
      if (q.feedId) { clauses.push("a.feed_id = ?"); params.push(q.feedId); }
      if (q.unreadOnly) { clauses.push("ua.read_at IS NULL"); }
      if (q.before) { clauses.push("(a.published_at IS NULL OR a.published_at < ?)"); params.push(q.before); }
      params.push(q.limit);
      const rows = db.prepare(`
        SELECT a.*, ua.read_at
        FROM articles a
        JOIN feeds f ON f.id = a.feed_id
        LEFT JOIN user_articles ua ON ua.article_id = a.id AND ua.user_id = ?
        WHERE ${clauses.join(" AND ")}
        ORDER BY a.published_at IS NULL, a.published_at DESC, a.fetched_at DESC
        LIMIT ?
      `).all(q.userId, ...params) as Record<string, unknown>[];
      return rows.map((r) => ({ ...rowToArticle(r), readAt: (r.read_at as string) ?? null }));
    },

    setRead(userId, articleId, read) {
      db.prepare(`
        INSERT INTO user_articles (user_id, article_id, read_at, starred_at)
        VALUES (?, ?, ?, NULL)
        ON CONFLICT (user_id, article_id) DO UPDATE SET read_at = excluded.read_at
      `).run(userId, articleId, read ? new Date().toISOString() : null);
    },

    markAllRead(userId, feedId) {
      db.prepare(`
        INSERT INTO user_articles (user_id, article_id, read_at, starred_at)
        SELECT ?, id, ?, NULL FROM articles WHERE feed_id = ?
        ON CONFLICT (user_id, article_id) DO UPDATE SET read_at = excluded.read_at
      `).run(userId, new Date().toISOString(), feedId);
    },

    unreadCounts(userId): Record<string, number> {
      const rows = db.prepare(`
        SELECT a.feed_id, COUNT(*) AS n
        FROM articles a
        JOIN feeds f ON f.id = a.feed_id
        LEFT JOIN user_articles ua ON ua.article_id = a.id AND ua.user_id = ?
        WHERE f.user_id = ? AND ua.read_at IS NULL
        GROUP BY a.feed_id
      `).all(userId, userId) as { feed_id: string; n: number }[];
      return Object.fromEntries(rows.map((r) => [r.feed_id, r.n]));
    },
  };
}
```

`packages/server/src/storage/index.ts`:
```ts
export type { Storage, Feed, Article, ArticleWithState, User } from "./types.js";
export { createSqliteStorage } from "./sqlite.js";
```

Note for implementer: `import.meta.dirname` requires Node 20.11+; under tsx/vitest it works. If vitest's transform strips it, use `fileURLToPath(new URL("migrations", import.meta.url))` instead. Also `this.getFeed` inside object literal method — if TS complains, extract to a local `getFeed` function and reference it from both.

- [ ] **Step 6: Run tests to verify they pass**

Run: `tman run -- pnpm --filter @reader/server test`
Expected: 8 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server
git commit -m "feat(server): add sqlite storage with migrations and read state"
```

---

### Task 5: `server` poller (interval adaptation + refresh logic)

**Files:**
- Create: `packages/server/src/poller/interval.ts`
- Create: `packages/server/src/poller/poller.ts`
- Create: `packages/server/test/interval.test.ts`
- Create: `packages/server/test/poller.test.ts`
- Create: `packages/server/test/fixtureServer.ts`

- [ ] **Step 1: Write interval tests**

`packages/server/test/interval.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { adaptInterval, backoffMinutes } from "../src/poller/interval.js";

describe("adaptInterval", () => {
  it("halves on new items, clamped to 15", () => {
    expect(adaptInterval(60, true)).toBe(30);
    expect(adaptInterval(15, true)).toBe(15);
  });
  it("doubles on empty, clamped to 1440", () => {
    expect(adaptInterval(60, false)).toBe(120);
    expect(adaptInterval(1000, false)).toBe(1440);
  });
});

describe("backoffMinutes", () => {
  it("is 2^errorCount clamped to 1440", () => {
    expect(backoffMinutes(0)).toBe(1);
    expect(backoffMinutes(3)).toBe(8);
    expect(backoffMinutes(20)).toBe(1440);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `tman run -- pnpm --filter @reader/server test -- interval`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement interval**

`packages/server/src/poller/interval.ts`:
```ts
const MIN = 15;
const MAX = 24 * 60;

export function adaptInterval(current: number, hadNewItems: boolean): number {
  const next = hadNewItems ? Math.floor(current / 2) : current * 2;
  return Math.min(MAX, Math.max(MIN, next));
}

export function backoffMinutes(errorCount: number): number {
  return Math.min(MAX, 2 ** errorCount);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `tman run -- pnpm --filter @reader/server test -- interval`
Expected: PASS.

- [ ] **Step 5: Write the poller test with a live fixture server**

`packages/server/test/fixtureServer.ts`:
```ts
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface FixtureFeed {
  xml: string;
  etag?: string;
  lastModified?: string;
  statusOnRequest?: number;
  requestCount: number;
}

export async function startFixtureServer(feeds: Record<string, Omit<FixtureFeed, "requestCount">>): Promise<{ server: Server; baseUrl: string; state: Map<string, FixtureFeed> }> {
  const state = new Map<string, FixtureFeed>(
    Object.entries(feeds).map(([k, v]) => [k, { ...v, requestCount: 0 }]),
  );
  const server = createServer((req, res) => {
    const path = req.url ?? "/";
    const feed = state.get(path);
    if (!feed) { res.writeHead(404).end(); return; }
    feed.requestCount++;
    if (feed.statusOnRequest) { res.writeHead(feed.statusOnRequest).end(); return; }
    if (feed.etag && req.headers["if-none-match"] === feed.etag) {
      res.writeHead(304).end(); return;
    }
    if (feed.lastModified && req.headers["if-modified-since"] === feed.lastModified) {
      res.writeHead(304).end(); return;
    }
    res.writeHead(200, {
      "content-type": "application/rss+xml",
      ...(feed.etag ? { etag: feed.etag } : {}),
      ...(feed.lastModified ? { "last-modified": feed.lastModified } : {}),
    });
    res.end(feed.xml);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}`, state };
}
```

`packages/server/test/poller.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Server } from "node:http";
import { createSqliteStorage } from "../src/storage/sqlite.js";
import { Poller } from "../src/poller/poller.js";
import { startFixtureServer } from "./fixtureServer.js";
import type { Storage } from "../src/storage/types.js";

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
<title>Fixture Blog</title><link>https://fixture.example.com</link>
<item><title>P1</title><link>https://fixture.example.com/1</link>
<guid>g1</guid><pubDate>Wed, 01 Jul 2026 12:00:00 GMT</pubDate>
<description>&lt;p&gt;one&lt;/p&gt;</description></item>
</channel></rss>`;

let storage: Storage;
let server: Server;
let baseUrl: string;
let state: Map<string, { xml: string; etag?: string; statusOnRequest?: number; requestCount: number }>;

beforeEach(async () => {
  storage = createSqliteStorage(":memory:");
  ({ server, baseUrl, state } = await startFixtureServer({
    "/feed.xml": { xml: RSS, etag: '"v1"' },
    "/broken.xml": { xml: "", statusOnRequest: 500 },
  }));
});

afterEach(async () => {
  storage.close();
  await new Promise((r) => server.close(r));
});

function subscribe(url: string) {
  const user = storage.getOrCreateLocalUser();
  return { user, feed: storage.createFeed(user.id, { url, title: url, siteUrl: null }) };
}

describe("Poller.refreshFeed", () => {
  it("fetches, parses, inserts articles and updates feed state", async () => {
    const { user, feed } = subscribe(`${baseUrl}/feed.xml`);
    const poller = new Poller(storage);
    const result = await poller.refreshFeed(feed.id);
    expect(result.newArticles).toBe(1);
    const updated = storage.getFeed(feed.id)!;
    expect(updated.title).toBe("Fixture Blog");
    expect(updated.etag).toBe('"v1"');
    expect(updated.errorCount).toBe(0);
    expect(updated.fetchIntervalMin).toBe(30); // halved from default 60
    expect(storage.listArticles({ userId: user.id, limit: 50 })).toHaveLength(1);
  });

  it("sends conditional headers and handles 304", async () => {
    const { feed } = subscribe(`${baseUrl}/feed.xml`);
    const poller = new Poller(storage);
    await poller.refreshFeed(feed.id);
    const result = await poller.refreshFeed(feed.id);
    expect(result.newArticles).toBe(0);
    expect(result.notModified).toBe(true);
    const updated = storage.getFeed(feed.id)!;
    expect(updated.fetchIntervalMin).toBe(60); // doubled back from 30
  });

  it("increments error count on failure without deleting articles", async () => {
    const { user, feed } = subscribe(`${baseUrl}/feed.xml`);
    const poller = new Poller(storage);
    await poller.refreshFeed(feed.id);
    const broken = storage.createFeed(user.id, { url: `${baseUrl}/broken.xml`, title: "b", siteUrl: null });
    const result = await poller.refreshFeed(broken.id);
    expect(result.error).toBeTruthy();
    expect(storage.getFeed(broken.id)!.errorCount).toBe(1);
    expect(storage.listArticles({ userId: user.id, limit: 50 })).toHaveLength(1);
  });

  it("marks feed broken after 10 consecutive errors", async () => {
    const { feed } = subscribe(`${baseUrl}/broken.xml`);
    const poller = new Poller(storage);
    for (let i = 0; i < 10; i++) await poller.refreshFeed(feed.id);
    expect(storage.getFeed(feed.id)!.status).toBe("broken");
  });
});

describe("Poller.tick", () => {
  it("refreshes only due feeds", async () => {
    const { feed } = subscribe(`${baseUrl}/feed.xml`);
    const poller = new Poller(storage);
    await poller.tick();
    expect(state.get("/feed.xml")!.requestCount).toBe(1);
    await poller.tick(); // not due anymore
    expect(state.get("/feed.xml")!.requestCount).toBe(1);
    expect(storage.getFeed(feed.id)!.errorCount).toBe(0);
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `tman run -- pnpm --filter @reader/server test -- poller`
Expected: FAIL — `../src/poller/poller.js` not found.

- [ ] **Step 7: Implement the poller**

`packages/server/src/poller/poller.ts`:
```ts
import pLimit from "p-limit";
import { parseFeed, sanitizeHtml } from "@reader/core";
import type { Storage, Feed } from "../storage/types.js";
import { adaptInterval, backoffMinutes } from "./interval.js";

export interface RefreshResult {
  newArticles: number;
  notModified?: boolean;
  error?: string;
}

const BROKEN_THRESHOLD = 10;

export class Poller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly tickMs: number;
  private readonly limit: ReturnType<typeof pLimit>;

  constructor(
    private readonly storage: Storage,
    opts: { tickMs?: number; concurrency?: number } = {},
  ) {
    this.tickMs = opts.tickMs ?? 60_000;
    this.limit = pLimit(opts.concurrency ?? 8);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((e) => console.error("[poller] tick error", e));
    }, this.tickMs);
    this.timer.unref?.();
    this.tick().catch((e) => console.error("[poller] tick error", e));
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    // Error backoff lives here, not in refreshFeed: manual/subscribe refreshes
    // must not be blocked by backoff (a user retry is the reset path).
    const now = Date.now();
    const due = this.storage.dueFeeds(new Date(now)).filter((f) => {
      if (f.errorCount === 0 || !f.lastFetchedAt) return true;
      return now >= new Date(f.lastFetchedAt).getTime() + backoffMinutes(f.errorCount) * 60_000;
    });
    await Promise.all(due.map((f) => this.limit(() => this.refreshFeed(f.id))));
  }

  async refreshFeed(feedId: string): Promise<RefreshResult> {
    const feed = this.storage.getFeed(feedId);
    if (!feed) return { newArticles: 0, error: "feed not found" };
    if (feed.status === "broken") return { newArticles: 0, error: "feed broken" };

    try {
      const res = await fetch(feed.url, {
        headers: {
          ...(feed.etag ? { "if-none-match": feed.etag } : {}),
          ...(feed.lastModified ? { "if-modified-since": feed.lastModified } : {}),
          "user-agent": "reader/0.1 (+local)",
          accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
        },
        signal: AbortSignal.timeout(15_000),
        redirect: "follow",
      });

      if (res.status === 304) {
        this.storage.updateFeedFetchState(feedId, {
          lastFetchedAt: new Date().toISOString(),
          fetchIntervalMin: adaptInterval(feed.fetchIntervalMin, false),
          errorCount: 0, status: "ok",
        });
        return { newArticles: 0, notModified: true };
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const xml = await res.text();
      const parsed = await parseFeed(xml);
      const inserted = this.storage.upsertArticles(feedId, parsed.articles, sanitizeHtml);

      this.storage.updateFeedFetchState(feedId, {
        etag: res.headers.get("etag"),
        lastModified: res.headers.get("last-modified"),
        lastFetchedAt: new Date().toISOString(),
        fetchIntervalMin: adaptInterval(feed.fetchIntervalMin, inserted.length > 0),
        errorCount: 0, status: "ok",
        title: parsed.title,
        siteUrl: parsed.siteUrl,
      });
      return { newArticles: inserted.length };
    } catch (e) {
      const errorCount = feed.errorCount + 1;
      this.storage.updateFeedFetchState(feedId, {
        lastFetchedAt: new Date().toISOString(),
        fetchIntervalMin: feed.fetchIntervalMin,
        errorCount,
        status: errorCount >= BROKEN_THRESHOLD ? "broken" : "ok",
      });
      return { newArticles: 0, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
```

- [ ] **Step 8: Run to verify pass**

Run: `tman run -- pnpm --filter @reader/server test`
Expected: all tests PASS (interval + poller + storage). Note: etag test — the fixture returns 304 on second request; ensure the feed row from `getFeed` inside `refreshFeed` is re-read each call (it is).

- [ ] **Step 9: Commit**

```bash
git add packages/server
git commit -m "feat(server): add poller with conditional get, adaptive interval, backoff"
```

---

### Task 6: `server` HTTP API + entrypoint

**Files:**
- Create: `packages/server/src/api/routes.ts`
- Create: `packages/server/src/api/server.ts`
- Create: `packages/server/src/index.ts`
- Create: `packages/server/test/api.test.ts`

- [ ] **Step 1: Write the failing API test**

`packages/server/test/api.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Server } from "node:http";
import { createServer } from "../src/api/server.js";
import { startFixtureServer } from "./fixtureServer.js";
import type { FastifyInstance } from "fastify";

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
<title>API Blog</title><link>https://api.example.com</link>
<item><title>A1</title><link>https://api.example.com/1</link>
<guid>a1</guid><pubDate>Wed, 01 Jul 2026 12:00:00 GMT</pubDate>
<description>&lt;p&gt;one&lt;/p&gt;</description></item>
</channel></rss>`;

let app: FastifyInstance;
let fixture: Server;
let baseUrl: string;

beforeEach(async () => {
  ({ server: fixture, baseUrl } = await startFixtureServer({ "/feed.xml": { xml: RSS, etag: '"e1"' } }));
  app = await createServer({ dbPath: ":memory:", poller: false });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await new Promise((r) => fixture.close(r));
});

describe("api", () => {
  it("subscribes to a feed, fetching initial content", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/feeds",
      payload: { url: `${baseUrl}/feed.xml` },
    });
    expect(res.statusCode).toBe(201);
    const feed = res.json();
    expect(feed.title).toBe("API Blog");

    const list = await app.inject({ method: "GET", url: "/api/v1/feeds" });
    expect(list.json().feeds).toHaveLength(1);
    expect(list.json().feeds[0].unreadCount).toBe(1);
  });

  it("rejects an unreachable feed with 422", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/feeds",
      payload: { url: `${baseUrl}/missing.xml` },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("feed_fetch_failed");
  });

  it("rejects duplicate subscription with 409", async () => {
    await app.inject({ method: "POST", url: "/api/v1/feeds", payload: { url: `${baseUrl}/feed.xml` } });
    const dup = await app.inject({ method: "POST", url: "/api/v1/feeds", payload: { url: `${baseUrl}/feed.xml` } });
    expect(dup.statusCode).toBe(409);
  });

  it("lists articles and marks read/unread", async () => {
    await app.inject({ method: "POST", url: "/api/v1/feeds", payload: { url: `${baseUrl}/feed.xml` } });
    const arts = await app.inject({ method: "GET", url: "/api/v1/articles" });
    const [a] = arts.json().articles;
    expect(a.readAt).toBeNull();

    const rd = await app.inject({ method: "POST", url: `/api/v1/articles/${a.id}/read`, payload: { read: true } });
    expect(rd.statusCode).toBe(204);

    const unread = await app.inject({ method: "GET", url: "/api/v1/articles?unread=1" });
    expect(unread.json().articles).toHaveLength(0);

    await app.inject({ method: "POST", url: `/api/v1/articles/${a.id}/read`, payload: { read: false } });
    const again = await app.inject({ method: "GET", url: "/api/v1/articles?unread=1" });
    expect(again.json().articles).toHaveLength(1);
  });

  it("mark-all-read clears unread count", async () => {
    const created = await app.inject({ method: "POST", url: "/api/v1/feeds", payload: { url: `${baseUrl}/feed.xml` } });
    const feedId = created.json().id;
    const res = await app.inject({ method: "POST", url: `/api/v1/feeds/${feedId}/mark-all-read` });
    expect(res.statusCode).toBe(204);
    const list = await app.inject({ method: "GET", url: "/api/v1/feeds" });
    expect(list.json().feeds[0].unreadCount).toBe(0);
  });

  it("unsubscribes and cascades", async () => {
    const created = await app.inject({ method: "POST", url: "/api/v1/feeds", payload: { url: `${baseUrl}/feed.xml` } });
    const feedId = created.json().id;
    const res = await app.inject({ method: "DELETE", url: `/api/v1/feeds/${feedId}` });
    expect(res.statusCode).toBe(204);
    const arts = await app.inject({ method: "GET", url: "/api/v1/articles" });
    expect(arts.json().articles).toHaveLength(0);
  });

  it("health endpoint returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.json()).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `tman run -- pnpm --filter @reader/server test -- api`
Expected: FAIL — `../src/api/server.js` not found.

- [ ] **Step 3: Implement API**

`packages/server/src/api/routes.ts`:
```ts
import type { FastifyInstance } from "fastify";
import type { Storage } from "../storage/types.js";
import type { Poller } from "../poller/poller.js";

interface SubscribeBody { url?: string }
interface ReadBody { read?: boolean }
interface ArticleQuery { feed_id?: string; unread?: string; before?: string; limit?: string }

export function registerRoutes(app: FastifyInstance, storage: Storage, poller: Poller): void {
  const userId = () => storage.getOrCreateLocalUser().id;

  app.get("/api/v1/health", async () => ({ ok: true }));

  app.post<{ Body: SubscribeBody }>("/api/v1/feeds", async (req, reply) => {
    const url = req.body?.url?.trim();
    if (!url || !/^https?:\/\//.test(url)) {
      return reply.code(400).send({ error: { code: "invalid_url", message: "url must be http(s)" } });
    }
    const uid = userId();
    const existing = storage.listFeeds(uid).find((f) => f.url === url);
    if (existing) {
      return reply.code(409).send({ error: { code: "duplicate", message: "already subscribed" }, feed: existing });
    }
    const feed = storage.createFeed(uid, { url, title: url, siteUrl: null });
    const result = await poller.refreshFeed(feed.id);
    if (result.error) {
      storage.deleteFeed(feed.id);
      return reply.code(422).send({ error: { code: "feed_fetch_failed", message: result.error } });
    }
    return reply.code(201).send(storage.getFeed(feed.id));
  });

  app.get("/api/v1/feeds", async () => {
    const uid = userId();
    const counts = storage.unreadCounts(uid);
    return {
      feeds: storage.listFeeds(uid).map((f) => ({
        ...f, unreadCount: counts[f.id] ?? 0,
      })),
    };
  });

  app.delete<{ Params: { id: string } }>("/api/v1/feeds/:id", async (req, reply) => {
    if (!storage.getFeed(req.params.id)) {
      return reply.code(404).send({ error: { code: "not_found", message: "feed not found" } });
    }
    storage.deleteFeed(req.params.id);
    return reply.code(204).send();
  });

  app.get<{ Querystring: ArticleQuery }>("/api/v1/articles", async (req) => {
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    const articles = storage.listArticles({
      userId: userId(),
      ...(req.query.feed_id ? { feedId: req.query.feed_id } : {}),
      unreadOnly: req.query.unread === "1",
      ...(req.query.before ? { before: req.query.before } : {}),
      limit,
    });
    return { articles };
  });

  app.post<{ Params: { id: string }; Body: ReadBody }>("/api/v1/articles/:id/read", async (req, reply) => {
    storage.setRead(userId(), req.params.id, req.body?.read !== false);
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>("/api/v1/feeds/:id/mark-all-read", async (req, reply) => {
    if (!storage.getFeed(req.params.id)) {
      return reply.code(404).send({ error: { code: "not_found", message: "feed not found" } });
    }
    storage.markAllRead(userId(), req.params.id);
    return reply.code(204).send();
  });
}
```

`packages/server/src/api/server.ts`:
```ts
import Fastify, { type FastifyInstance } from "fastify";
import { createSqliteStorage } from "../storage/sqlite.js";
import { Poller } from "../poller/poller.js";
import { registerRoutes } from "./routes.js";

export interface ServerOptions {
  dbPath: string;
  poller?: boolean;
  tickMs?: number;
}

export async function createServer(opts: ServerOptions): Promise<FastifyInstance> {
  const storage = createSqliteStorage(opts.dbPath);
  const poller = new Poller(storage, opts.tickMs !== undefined ? { tickMs: opts.tickMs } : {});
  if (opts.poller !== false) poller.start();

  const app = Fastify({ logger: true });
  registerRoutes(app, storage, poller);
  app.addHook("onClose", async () => {
    poller.stop();
    storage.close();
  });
  return app;
}
```

`packages/server/src/index.ts`:
```ts
import { createServer } from "./api/server.js";

const dbPath = process.env.READER_DB ?? "reader.db";
const app = await createServer({ dbPath });

const port = await app.listen({ port: Number(process.env.READER_PORT ?? 0), host: "127.0.0.1" });
// Electron parent parses this line to learn the actual port.
console.log(`READER_PORT=${new URL(port).port}`);
```

- [ ] **Step 4: Run to verify pass**

Run: `tman run -- pnpm --filter @reader/server test`
Expected: all API tests PASS plus prior suites (storage, interval, poller).

- [ ] **Step 5: Commit**

```bash
git add packages/server
git commit -m "feat(server): add fastify api for feeds, articles, read state"
```

---

### Task 7: `web` minimal UI

**Files:**
- Create: `apps/web/index.html`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/api.ts`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/Sidebar.tsx`
- Create: `apps/web/src/ArticleList.tsx`
- Create: `apps/web/src/ArticleView.tsx`
- Create: `apps/web/src/styles.css`
- Test: `apps/web/src/api.test.ts`

- [ ] **Step 1: Scaffold Vite files**

`apps/web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Reader</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web/vite.config.ts`:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": "http://127.0.0.1:3737" },
  },
});
```

(The dev server runs on a fixed port: `READER_PORT=3737 pnpm dev:server`.)

- [ ] **Step 2: Write API client + failing test**

`apps/web/src/api.ts`:
```ts
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
```

`apps/web/src/api.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "./api";

beforeEach(() => vi.restoreAllMocks());

describe("api client", () => {
  it("builds article query params", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ articles: [] }), { status: 200 }),
    );
    await api.listArticles({ feedId: "f1", unread: true });
    expect(spy).toHaveBeenCalledWith(
      "/api/v1/articles?feed_id=f1&unread=1",
      expect.objectContaining({ headers: { "content-type": "application/json" } }),
    );
  });

  it("throws server error message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "duplicate", message: "already subscribed" } }), { status: 409 }),
    );
    await expect(api.subscribe("http://x")).rejects.toThrow("already subscribed");
  });
});
```

- [ ] **Step 3: Run to verify failure then implementation status**

Run: `tman run -- pnpm --filter @reader/web test`
Expected: the two tests above PASS once `api.ts` exists (the client is written in Step 2; run now confirms).

- [ ] **Step 4: Implement UI components**

`apps/web/src/main.tsx`:
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import "./styles.css";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
```

`apps/web/src/App.tsx`:
```tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Article } from "./api";
import { Sidebar } from "./Sidebar";
import { ArticleList } from "./ArticleList";
import { ArticleView } from "./ArticleView";

export function App() {
  const [feedId, setFeedId] = useState<string | null>(null);
  const [article, setArticle] = useState<Article | null>(null);

  const articles = useQuery({
    queryKey: ["articles", feedId],
    queryFn: () => api.listArticles(feedId ? { feedId } : {}),
  });

  return (
    <div className="layout">
      <Sidebar selectedFeedId={feedId} onSelectFeed={(id) => { setFeedId(id); setArticle(null); }} />
      <ArticleList
        articles={articles.data ?? []}
        loading={articles.isLoading}
        selectedId={article?.id ?? null}
        onSelect={setArticle}
      />
      <ArticleView article={article} />
    </div>
  );
}
```

`apps/web/src/Sidebar.tsx`:
```tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

export function Sidebar(props: { selectedFeedId: string | null; onSelectFeed: (id: string | null) => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const feeds = useQuery({ queryKey: ["feeds"], queryFn: api.listFeeds });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["feeds"] });
    qc.invalidateQueries({ queryKey: ["articles"] });
  };
  const sub = useMutation({
    mutationFn: api.subscribe,
    onSuccess: () => { setUrl(""); setError(null); invalidate(); },
    onError: (e) => setError(e.message),
  });
  const unsub = useMutation({ mutationFn: api.unsubscribe, onSuccess: invalidate });
  const markAll = useMutation({ mutationFn: api.markAllRead, onSuccess: invalidate });

  const total = (feeds.data ?? []).reduce((n, f) => n + f.unreadCount, 0);

  return (
    <nav className="sidebar">
      <h1>Reader</h1>
      <form onSubmit={(e) => { e.preventDefault(); if (url.trim()) sub.mutate(url.trim()); }}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Add feed URL" />
        <button type="submit" disabled={sub.isPending}>Add</button>
      </form>
      {error && <p className="error">{error}</p>}
      <ul>
        <li className={props.selectedFeedId === null ? "selected" : ""}>
          <button onClick={() => props.onSelectFeed(null)}>All items ({total})</button>
        </li>
        {(feeds.data ?? []).map((f) => (
          <li key={f.id} className={props.selectedFeedId === f.id ? "selected" : ""}>
            <button onClick={() => props.onSelectFeed(f.id)}>
              {f.status === "broken" && <span title="Feed is failing">⚠ </span>}
              {f.title} ({f.unreadCount})
            </button>
            <button title="Mark all read" onClick={() => markAll.mutate(f.id)}>✓</button>
            <button title="Unsubscribe" onClick={() => { if (confirm(`Unsubscribe from ${f.title}?`)) unsub.mutate(f.id); }}>×</button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
```

`apps/web/src/ArticleList.tsx`:
```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Article } from "./api";

export function ArticleList(props: {
  articles: Article[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (a: Article) => void;
}) {
  const qc = useQueryClient();
  const setRead = useMutation({
    mutationFn: ({ id, read }: { id: string; read: boolean }) => api.setRead(id, read),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["articles"] });
      qc.invalidateQueries({ queryKey: ["feeds"] });
    },
  });

  if (props.loading) return <section className="list">Loading…</section>;
  if (props.articles.length === 0) return <section className="list">No articles.</section>;

  return (
    <section className="list">
      <ul>
        {props.articles.map((a) => (
          <li key={a.id} className={`${a.readAt ? "read" : "unread"} ${props.selectedId === a.id ? "selected" : ""}`}>
            <button
              onClick={() => {
                props.onSelect(a);
                if (!a.readAt) setRead.mutate({ id: a.id, read: true });
              }}
            >
              {a.title}
            </button>
            <span className="date">{a.publishedAt ? new Date(a.publishedAt).toLocaleDateString() : ""}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

`apps/web/src/ArticleView.tsx`:
```tsx
import type { Article } from "./api";

export function ArticleView(props: { article: Article | null }) {
  const a = props.article;
  if (!a) return <main className="reader empty">Select an article</main>;
  return (
    <main className="reader">
      <h2>{a.url ? <a href={a.url} target="_blank" rel="noopener noreferrer">{a.title}</a> : a.title}</h2>
      <p className="meta">
        {a.author && <span>{a.author} · </span>}
        {a.publishedAt && new Date(a.publishedAt).toLocaleString()}
      </p>
      {a.contentHtml
        ? <article dangerouslySetInnerHTML={{ __html: a.contentHtml }} />
        : <p>{a.summary ?? "(no content)"}</p>}
    </main>
  );
}
```

`apps/web/src/styles.css`:
```css
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; }
.layout { display: grid; grid-template-columns: 260px 340px 1fr; height: 100vh; }
.sidebar { border-right: 1px solid #ddd; padding: 12px; overflow-y: auto; }
.sidebar h1 { font-size: 1.2rem; }
.sidebar form { display: flex; gap: 4px; margin-bottom: 12px; }
.sidebar input { flex: 1; min-width: 0; }
.sidebar ul { list-style: none; padding: 0; }
.sidebar li { display: flex; gap: 4px; }
.sidebar li > button:first-child { flex: 1; text-align: left; background: none; border: none; padding: 4px; cursor: pointer; }
.sidebar li.selected > button:first-child { font-weight: 700; }
.error { color: #b00; font-size: 0.85rem; }
.list { border-right: 1px solid #ddd; overflow-y: auto; }
.list ul { list-style: none; margin: 0; padding: 0; }
.list li { display: flex; justify-content: space-between; gap: 8px; border-bottom: 1px solid #eee; }
.list li button { flex: 1; text-align: left; background: none; border: none; padding: 10px; cursor: pointer; }
.list li.read button { color: #777; }
.list li.unread button { font-weight: 600; }
.list li.selected { background: #eef4ff; }
.date { font-size: 0.75rem; color: #999; padding: 10px 8px 0 0; white-space: nowrap; }
.reader { padding: 16px 24px; overflow-y: auto; max-width: 720px; }
.reader.empty { color: #999; }
.reader img { max-width: 100%; height: auto; }
.meta { color: #888; font-size: 0.85rem; }
```

- [ ] **Step 5: Verify build and tests**

Run: `tman run -- pnpm --filter @reader/web test && pnpm --filter @reader/web build`
Expected: 2 tests PASS; vite build succeeds.

- [ ] **Step 6: Manual smoke (dev)**

Run server: `READER_PORT=3737 pnpm dev:server` (background via tman)
Run web: `pnpm dev:web`
Check: open vite URL, add a feed URL (e.g. any public RSS), article appears, click marks read, unread counts update.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): add minimal three-pane reader ui"
```

---

### Task 8: `desktop` Electron shell

**Files:**
- Create: `apps/desktop/src/main.ts`
- Create: `apps/desktop/tsconfig.json`

- [ ] **Step 1: Implement main process**

`apps/desktop/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

`apps/desktop/src/main.ts`:
```ts
import { app, BrowserWindow } from "electron";
import { fork, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";

let server: ChildProcess | null = null;

function startServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    const tsx = join(import.meta.dirname, "../../../node_modules/tsx/dist/cli.mjs");
    const entry = join(import.meta.dirname, "../../../packages/server/src/index.ts");
    server = fork(entry, [], {
      execPath: process.execPath,
      execArgv: [tsx],
      env: {
        ...process.env,
        READER_DB: join(app.getPath("userData"), "reader.db"),
        READER_PORT: "0",
      },
      stdio: ["ignore", "pipe", "inherit", "ipc"],
    });
    const rl = createInterface({ input: server.stdout! });
    const timeout = setTimeout(() => reject(new Error("server start timeout")), 15_000);
    rl.on("line", (line) => {
      const m = /^READER_PORT=(\d+)$/.exec(line.trim());
      if (m) { clearTimeout(timeout); resolve(Number(m[1])); }
    });
    server.on("exit", (code) => reject(new Error(`server exited early: ${code}`)));
  });
}

app.whenReady().then(async () => {
  const port = await startServer();
  const win = new BrowserWindow({ width: 1280, height: 800, autoHideMenuBar: true });
  await win.loadURL(`http://127.0.0.1:${port}`);
});

app.on("window-all-closed", () => {
  server?.kill();
  app.quit();
});
```

Note: Electron loads the API-only server URL in dev until Task 8 Step 2 wires the web build. For M1 dev, point Electron at the Vite dev server when `READER_WEB_DEV_URL` is set:

Add after `const win = ...`:
```ts
const devUrl = process.env.READER_WEB_DEV_URL;
await win.loadURL(devUrl ?? `http://127.0.0.1:${port}`);
```
(Replace the earlier `win.loadURL` line with this.)

- [ ] **Step 2: Serve the web build from the server in production mode**

Modify `packages/server/src/api/server.ts` — after `registerRoutes(...)` add:

```ts
const webDist = process.env.READER_WEB_DIST;
if (webDist) {
  const { default: fastifyStatic } = await import("@fastify/static");
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) {
      return reply.code(404).send({ error: { code: "not_found", message: "not found" } });
    }
    return reply.sendFile("index.html");
  });
}
```

Add dependency: `pnpm --filter @reader/server add @fastify/static`

In `apps/desktop/src/main.ts`, add to the fork `env`:
```ts
READER_WEB_DIST: join(import.meta.dirname, "../../../apps/web/dist"),
```

- [ ] **Step 3: Verify**

Run: `tman run -- pnpm --filter @reader/web build && pnpm --filter @reader/desktop dev`
Expected: Electron window opens, reader UI loads from the local server, feed subscribe/read flows work, DB persists at Electron userData dir.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop packages/server
git commit -m "feat(desktop): add electron shell forking local reader server"
```

---

### Task 9: M1 closeout — full verification

- [ ] **Step 1: Full test run**

Run: `tman run -- pnpm -r test`
Expected: all suites PASS (core 7, server ~19, web 2).

- [ ] **Step 2: Full build**

Run: `tman run -- pnpm -r build`
Expected: all packages compile/build.

- [ ] **Step 3: Commit any residue**

```bash
git status   # expect clean except possibly lockfile updates
git add pnpm-lock.yaml
git commit -m "chore: finalize m1 dependency lockfile" --allow-empty
```

---

## Post-M1 notes (deferred to later milestone plans)

- M2: folders, starring, keyboard nav, mark-read-on-scroll, settings
- M3: FTS search, full-text extraction
- M4: OPML, hosted auth, PG adapter, deployment
- M5: Google Reader API compat, offline service worker
