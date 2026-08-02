# Reader Clone — Design

Date: 2026-08-01
Status: Approved for implementation planning

A Google Reader clone: RSS/Atom feed reader running both as an Electron desktop app and as a hosted web service, from one shared TypeScript codebase.

## 1. Goals & Scope

Core features (v1):

- Feed reading: subscribe to RSS/Atom feeds, background refresh, article list, read/unread state
- Star / read-later
- Full-text search (FTS over title, author, content)
- Folders/tags for feed organization + classic Reader keyboard navigation (j/k/n/p/s/m/shift+a)
- OPML import/export
- Google Reader API compatibility subset (for third-party clients)
- Offline web support (service worker + mutation replay)
- Per-feed full-text content extraction toggle (Readability)

Non-goals (v1): social/sharing features, recommendations, mobile apps, Electron auto-updater.

## 1a. Future direction: agents as publishers (recorded 2026-08-01)

The reader is a natural substrate for chunked agent-driven updates — daily research digests, long-running refactoring progress, scheduled task output. An agent that can write an Atom file to a URL is already subscribable with the architecture as designed. A future milestone (v1.x) can make this first-class with a minimal delta: agents write Atom files to a watched directory (or POST to a local publish endpoint), and the reader auto-subscribes. No design changes required now; noted so later plans keep the door open (e.g., don't hardcode assumptions that all feeds are remote HTTP).

## 2. Architecture

Approach: **monorepo, single Node/TS backend, pluggable storage**.

```
reader/
  apps/
    web/          React + Vite SPA (served by server in hosted mode; loaded by Electron in desktop mode)
    desktop/      Electron shell (main process + preload)
  packages/
    core/         Feed parsing, OPML import/export, sanitization, shared types
    server/       Fastify HTTP API, background poller, storage adapter, auth
  docs/
```

- Package manager: pnpm workspaces.
- **Storage adapter** (`packages/server/storage/`): single `Storage` interface, two implementations:
  - `sqlite` (better-sqlite3) — default; used in Electron/local mode and tests
  - `pg` (Postgres) — hosted mode, selected via `DATABASE_URL`
  - Migrations: plain SQL files run at startup.
- **Hosted mode**: server serves API + static web build. Per-user accounts, email+password (argon2 hash), session cookie.
- **Electron mode**: same server runs as a forked child process, single implicit local user, SQLite at userData dir.
- **Auth boundary**: all API routes pass through an auth middleware resolving to either the hosted session user or the local single user. No other code branches on deployment mode.

## 3. Data Model

Same DDL for SQLite and PG modulo types:

- `users` — id, email, password_hash, created_at (hosted only; local mode has one implicit row)
- `feeds` — id, user_id, url, title, site_url, etag, last_modified, last_fetched_at, fetch_interval_min, error_count, full_text_toggle
- `folders` — id, user_id, name
- `feed_folders` — feed_id, folder_id (feeds may be in multiple folders)
- `articles` — id, feed_id, guid, url, title, author, published_at, content_html, summary, extracted_html (nullable)
- `user_articles` — user_id, article_id, read_at, starred_at; unique (user_id, article_id)

Indexes/constraints:

- unique `(feed_id, guid)` on articles
- index `(user_id, read_at)` on user_articles
- Full-text search: SQLite FTS5 virtual table over articles (title, author, content text); PG mode uses a `tsvector` column. The adapter hides the difference.

## 4. Server Components (`packages/server`)

### 4.1 Poller

Single in-process scheduler. Each tick selects feeds where `now - last_fetched_at > fetch_interval_min`.

- Fetches with conditional GET (etag / last-modified).
- Adaptive interval: halves after new items, doubles after empty fetches, clamped to [15 min, 24 h].
- Parses via `packages/core`, upserts articles with guid dedupe.
- Error handling: increment `error_count`, exponential backoff (skip until `2^error_count` minutes, capped); 10 consecutive failures marks feed "broken" and stops polling until user retries. Never delete articles on feed errors.
- Bounded concurrency pool (~8 in-flight fetches); one slow feed never blocks others.

### 4.2 Full-text extractor

For feeds with `full_text_toggle` on: lazily fetches the article URL, extracts content with Mozilla Readability, sanitizes with DOMPurify, stores in `extracted_html`. Queue with small concurrency. Failure leaves the field null; UI falls back to feed content silently (no error shown — it was an enhancement).

### 4.3 HTTP API (Fastify, JSON)

Two surfaces:

**Web API (`/api/v1/…`)** — consumed by our React app:

- Feeds/folders CRUD
- Article streams: `?folder=&feed=&unread=&starred=&before=` with cursor pagination
- Mark read/starred (single + batch)
- Search: `/api/v1/search?q=` (supports quoted phrases and `feed:` scoping)
- OPML import/export
- Settings

**Google Reader API (`/reader/api/0/…`)** — compat subset mapping to the same storage calls:

- `subscription/list`, `subscription/edit`
- `stream/contents/*`
- `edit-tag`, `mark-all-as-read`, `token`

Consistent error shape: `{error: {code, message}}`. 4xx for client faults; 5xx logged with request id. Poller/extractor failures never crash the server — each job is wrapped, failures counted and logged.

### 4.4 OPML

Import: parse, dedupe by URL, subscribe all, kick off async initial fetch, return immediately with accepted count. Export: folders become nested outlines.

## 5. Web Client (`apps/web`)

React 19, Vite, react-router, TanStack Query (server state), Zustand (UI state only: selection, layout).

Classic three-pane layout: folders/feeds | article list | article view.

- Routes: `/` (all items), `/folder/:id`, `/feed/:id`, `/starred`, `/search?q=`
- Keyboard nav: j/k next/prev article, n/p skip unread, s star, m mark read, shift+a mark all read, `/` focus search, 1/2/3 layout modes, `?` help overlay. One global handler hook.
- Mark-as-read-on-scroll: articles crossing the viewport top are marked read after 1s dwell (classic Reader behavior); toggleable in settings.
- Article rendering: server-sanitized HTML (`extracted_html ?? content_html`), lazy-loaded images, `referrerpolicy=no-referrer`.
- Feed health: broken/errored feeds show a warning badge.

## 6. Offline Web Support (hosted mode)

Workbox service worker:

- App shell: cache-first
- API streams: network-first, fall back to cached response
- Background "offline sync" action pre-caches the latest N unread articles + images (default N=200, 0 disables)
- Offline mutations (read/star) queue in IndexedDB, replay on reconnect. Last-write-wins — these are idempotent state flags, no CRDT needed.

## 7. Electron Shell (`apps/desktop`)

Thin wrapper:

- Main process forks the server as a child, SQLite in userData dir
- Binds `127.0.0.1` only, random port (loopback exposure posture); waits for readiness
- Loads `http://127.0.0.1:<port>` with a session token passed via preload
- Single window, native menus for OPML import/export
- Packaged with electron-builder

## 8. Testing

Vitest everywhere. Hierarchy: e2e > integration > unit.

- **Unit** (`packages/core`): feed parser against ~20 fixture feeds (RSS 0.9x/1.0/2.0, Atom, malformed), OPML round-trip, sanitizer vs XSS corpus, backoff math
- **Integration** (`packages/server`): API tests against real SQLite (fresh test DB per suite); fixture feeds served by a local HTTP server (no network mocks); poller integration asserting dedupe, etag handling, backoff, interval adaptation; storage adapter contract suite run against both SQLite and PG (PG via docker in CI)
- **E2e** (Playwright, small set): subscribe → poll → article appears → keyboard nav marks read → star persists across reload; OPML import; offline mutation replay (kill network, star, reconnect)
- **Compat smoke**: replay recorded Google Reader API request sequences from a real client against `/reader/api/0/`

## 9. Milestones

Each independently shippable:

1. `core` + storage + poller + minimal API + minimal list/reader UI (Electron runs it)
2. Folders, starring, mark-read-on-scroll, keyboard nav, settings
3. Search (FTS), full-text extraction toggle
4. OPML import/export, hosted mode (auth, PG adapter), deployment config — **blocker:** SSRF guard on feed fetching before any hosted deployment (subscribe accepts arbitrary URLs; resolve host and reject private/link-local/loopback ranges, re-validate after redirects)
5. Google Reader API compat, offline service worker, polish
