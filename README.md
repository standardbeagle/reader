# reader

A Google Reader clone for the agent era — an RSS/Atom feed reader that runs as an **Electron desktop app** or a **hosted web service** from one shared TypeScript codebase.

📚 **Docs: [dev.standardbeagle.com/reader](https://dev.standardbeagle.com/reader)** — quick start, user guide, API reference, hosting, configuration, and changelog.
🎯 **Demo: [dev.standardbeagle.com/reader/demo](https://dev.standardbeagle.com/reader/demo/)** — the full app on bundled content, no install.

![article view](docs/screenshots/article-view.png)

RSS was always pull-based updates from publishers. Agents are exactly the kind of prolific, structured publishers that drown a chat UI but fit a feed perfectly. This reader treats feeds as the universal subscription format — blogs today, agent digests tomorrow.

## Features

- **Feed reading** — RSS 2.0 / Atom subscriptions, background polling with conditional GET (etag/last-modified), adaptive refresh intervals, exponential backoff on failures
- **OPML import** — move subscriptions in from any other reader in one go
- **Classic three-pane UI** — feeds · article list · article view, with a mobile layout, swipe navigation, and installable PWA support
- **Pinboard view** — image-led card grid for the article list
- **Unread-only navigation** — edge dots mark unread neighbors; a header toggle restricts prev/next (buttons, swipe, j/k) to unread articles
- **Read state** — mark read on click, mark-all-read, per-feed unread counts
- **Snooze** — hide an article until later (later today / tomorrow / next week); it stays unread and resurfaces when the snooze expires
- **Saved lists** — permanent collections of articles, public or private; every public list is itself an RSS feed at `/lists/<token>.xml`
- **Ingestors** — Mastodon, Bluesky, and Reddit timelines as feeds, or several feeds merged into one AI-filtered, summarized view; digest modes and LLM keep/drop threshold
- **Keyboard shortcuts** — j/k browse, snooze from the keyboard, bind keys to saved lists
- **XSS-safe rendering** — every article body sanitized server-side with DOMPurify
- **Local-first** — embedded SQLite, no account needed; the hosted mode shares the same codebase
- **Loopback-only by default** — binds 127.0.0.1; exposure is a deliberate opt-in

## Roadmap

| Milestone | Status | Contents |
|-----------|--------|----------|
| M1 | ✅ done | parser, sanitizer, storage, poller, API, minimal UI, Electron shell |
| M2 | 🔶 partial | keyboard nav (j/k shipped), snooze, saved lists; folders, starring, mark-read-on-scroll planned |
| M3 | planned | full-text search, per-feed full-text extraction (Readability) |
| M4 | 🔶 partial | OPML import shipped, hosted deployment live; multi-user (auth, Postgres) planned |
| M5 | planned | Google Reader API compat, offline web (service worker) |

Shipped since the roadmap was written: snooze, saved lists with public RSS feeds, ingestors (Mastodon / Bluesky / Reddit / combined AI view), OPML import, pinboard view, unread-only navigation, and the hosted deployment behind Cloudflare Access.

Future direction: **agents as publishers** — an agent that can write an Atom file to a URL is already subscribable; a future milestone makes that first-class (watched directory / publish endpoint).

## Quickstart

Requires Node 22+ and pnpm.

```bash
pnpm install
pnpm -r build

# web dev (API on :3737, vite on :5173)
READER_PORT=3737 pnpm dev:server
pnpm dev:web

# desktop (after one-time native rebuild, see apps/desktop/README.md)
pnpm --filter @reader/desktop dev

# tests
pnpm -r test
```

## Architecture

```
apps/
  web/          React + Vite SPA
  desktop/      Electron shell (forks the server on 127.0.0.1, random port)
packages/
  core/         feed parsing, HTML sanitization, shared types — no I/O
  server/       Fastify API, background poller, storage adapter (SQLite now, Postgres in M4)
```

Design spec: [docs/superpowers/specs/2026-08-01-reader-clone-design.md](docs/superpowers/specs/2026-08-01-reader-clone-design.md)

## License

[MIT](LICENSE)
