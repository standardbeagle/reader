---
title: Quick start
description: Install and run reader as a web app or an Electron desktop app.
---

reader requires Node 22+ and pnpm.

```bash
git clone https://github.com/standardbeagle/reader.git
cd reader
pnpm install
pnpm -r build
```

## Run the web app

Two processes: the API server on port 3737 and the Vite dev server on 5173.

```bash
READER_PORT=3737 pnpm dev:server   # terminal 1
pnpm dev:web                       # terminal 2
```

Open `http://localhost:5173`. The SPA proxies `/api/*` to the server.

## Run the desktop app

The Electron shell forks the server on 127.0.0.1 with a random port, so the
same codebase powers both. better-sqlite3 needs a one-time native rebuild
against Electron's ABI — see `apps/desktop/README.md` — then:

```bash
pnpm --filter @reader/desktop dev
```

## Run the tests

```bash
pnpm -r test
```

Tests cover the core parsers (RSS, Atom, JSON Feed, h-feed, transcripts) and
the sanitizer; the server API, OAuth flows and real-time streams, against
local fake servers; and the web app's URL, error, and grouping logic. No test
needs network access or platform credentials.

## Subscribe to something

Click **+ Add source** in the sidebar and paste a feed or a site's home page.
The server finds the site's RSS, Atom or JSON feed, or reads the page itself
when it is an IndieWeb h-feed. Articles appear within seconds of the first
fetch, and feeds that page their history fill in older items after that.
Private feeds take a username and password, a token, or an OAuth sign-in in
the same step. [Adding sources](/reader/user/sources/) covers the details.

## Move your subscriptions in

**+ Add source → OPML import** reads an OPML file exported from any other
reader (Feedly, Inoreader, FreshRSS, …) and subscribes to every feed in it at
once. Feeds you already follow are skipped; the first fetch runs in the
background, so large imports fill in over the next minutes.

**+ Add source → YouTube subscriptions** does the same for YouTube, which has
no subscriptions feed of its own: give it the `subscriptions.csv` from a
Google Takeout export and it follows each channel's feed.

## Try the demo

[dev.standardbeagle.com/reader/demo/](/reader/demo/) runs the full web app on
bundled content — no install, no server. Read, snooze, and list changes stay
in your browser.
