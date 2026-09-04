---
title: reader
description: A Google Reader clone for the agent era — RSS/Atom reading as an Electron desktop app or a hosted web service from one TypeScript codebase.
---

reader is an open-source Google Reader clone that runs as an **Electron desktop
app** or a **hosted web service** from one shared TypeScript codebase. RSS was
always pull-based updates from publishers; agents are exactly the kind of
prolific, structured publishers that drown a chat UI but fit a feed perfectly.
reader treats feeds as the universal subscription format — blogs today, agent
digests tomorrow.

## What you get

- **Feed reading** — RSS 2.0 / Atom subscriptions, background polling with
  conditional GET (etag / last-modified), adaptive refresh intervals, and
  exponential backoff on failures.
- **Classic three-pane UI** — feeds · article list · article view, with a
  mobile layout, swipe navigation, and installable PWA support.
- **Read state** — mark read on open, mark-all-read per feed, per-feed unread
  counts.
- **Snooze** — hide an article until later today, tomorrow, or next week; it
  stays unread and resurfaces when the snooze expires.
- **Saved lists** — permanent article collections, private or public; every
  public list is itself an RSS feed at `/lists/<token>.xml`.
- **Ingestors** — pull Mastodon, Bluesky, or Reddit timelines in as feeds,
  with optional LLM filtering and summarization.
- **XSS-safe rendering** — every article body is sanitized server-side with
  DOMPurify.
- **Local-first** — embedded SQLite, no account needed; the hosted mode shares
  the same codebase.
- **Loopback-only by default** — the server binds 127.0.0.1; wider exposure is
  a deliberate opt-in.

## Where to go next

- [Quick start](/reader/getting-started/) — run the web app or the desktop app.
- [User guide](/reader/user/reading/) — the three-pane UI, filters, and navigation.
- [Hosting](/reader/hosting/) — systemd, Cloudflare tunnel, and the production layout.
- [Configuration](/reader/configuration/) — environment variables and secrets.
- [HTTP API](/reader/reference/api/) — every endpoint the SPA uses.
