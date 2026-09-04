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

Tests cover the core parser and sanitizer, the server API (including snooze
and lists), and the web app's URL, error, and grouping logic. Live API tests
for platform ingestors (Bluesky, Reddit) run against the real services and
are skipped when credentials are absent.

## Subscribe to something

Click **+ Add feed** in the sidebar and paste any RSS/Atom URL — the server
auto-discovers feeds behind common blog URLs. Articles appear within seconds
of the initial fetch.
