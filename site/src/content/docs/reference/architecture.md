---
title: Architecture
description: How the reader monorepo is structured — core, server, web, and desktop packages — and how feeds, sign-ins and real-time streams flow through it.
---

reader is a pnpm monorepo of four packages sharing one TypeScript codebase:

```
packages/
  core/     feed parsing (RSS 2.0 / RDF / Atom / JSON Feed / h-feed),
            podcast transcripts and chapters, OPML and YouTube Takeout
            imports, HTML sanitization — pure logic, no I/O
  server/   Fastify API, background poller, ingestor engine, credentials
            and OAuth sign-in, real-time streams, storage adapter (SQLite
            today, Postgres planned)
apps/
  web/      React + Vite SPA, PWA
  desktop/  Electron shell that forks the server on 127.0.0.1 with a
            random port
```

## Request flow

1. **Poller** fetches each feed with conditional GET (`etag` /
   `last-modified`) on adaptive intervals, never faster than the feed's
   `ttl` or `Cache-Control: max-age`, pausing for `Retry-After`. Failures
   back off exponentially. A feed with a credential gets its
   `Authorization` header from `auth/credentials.ts`, which refreshes
   expiring OAuth tokens.
2. **core** picks the format by content: JSON Feed for a `{` document, h-feed
   for a whole HTML page, RSS/Atom otherwise. It rejects doctype internal
   subsets and oversized input before parsing.
3. **Sanitizer** — article HTML passes through DOMPurify server-side before
   storage; the SPA never renders raw feed bytes. Summaries are plain text:
   any HTML-looking summary is promoted to `contentHtml` and sanitized.
4. **Storage** — SQLite via better-sqlite3 in embedded mode.
5. **Backfill** — after a new subscription's first fetch, the poller follows
   the feed's link to older items (RFC 5005, JSON Feed `next_url`) for up to
   ten pages, storing those items as read.
6. **API** — the SPA talks to `/api/v1/*` only; the server serves the built
   SPA when `READER_WEB_DIST` is set.

Ingestors run beside the poller: an adapter per platform fetches posts,
which are staged, filtered and summarized by the LLM pipeline, and delivered
as articles. Work for one ingestor runs in sequence, so a stream batch and a
scheduled fetch never run the pipeline over the same posts at once.

## Real-time streams

`packages/server/src/realtime/` holds outbound WebSocket clients: the Podping
relay (podcast updates), Bluesky Jetstream, and the Mastodon streaming API. A
hub compares them with the subscriptions once a minute and opens or closes
sockets to match, so a stream exists only while something needs it. Each
socket reconnects with exponential backoff up to five minutes. Podping
triggers an immediate refresh of the named feed; social streams hand posts
to the ingestor engine. Polling keeps running underneath, and
`GET /api/v1/realtime` reports every socket's state.

## Sign-in

Credentials live in their own table so one account can serve many sources.
OAuth sign-ins are authorization-code flows. Mastodon registers an app on
the instance on the fly, Reddit uses the user's own web app, and other
providers always use PKCE. The provider redirects the user's browser back to
`/api/v1/oauth/callback`, never a server-to-server call, so sign-in works on
a loopback-only server.

## Security posture

- The server binds **127.0.0.1** by default; exposure is an explicit opt-in.
- Outbound fetches and WebSocket connects (feed polling, ingestors, OAuth
  token exchanges, transcripts, streams) pass a guard that refuses
  private/loopback addresses unless `READER_ALLOW_PRIVATE_FETCH` is set, and
  re-checks every redirect hop.
- Each credential is bound to one origin. `authorizationFor` refuses any
  other URL, and redirects to another host drop `Authorization`, `Cookie`
  and `Proxy-Authorization`. The one widening: a Mastodon token may reach
  the instance's streaming host when it is the same host or a subdomain of
  it.
- Secrets never appear in API responses, and internal override keys are
  stripped from ingestor configs before storage.
- The HTTP listener declares connection caps, body-size limits, and timeouts;
  WebSocket frames over 256 KB are dropped unread.

## Conventions

- **Tests**: `pnpm -r test` — vitest everywhere. Unit tests for core logic;
  API tests boot the Fastify server in-process; OAuth providers, feeds and
  stream servers are local fakes, so no test touches the network.
- **Migrations**: SQL migrations ship with the server package and run on
  boot.
- **Commits**: conventional commits, one logical unit per commit.

The design spec and plan history live in `docs/superpowers/`.
