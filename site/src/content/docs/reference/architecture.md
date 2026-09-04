---
title: Architecture
description: How the reader monorepo is structured — core, server, web, and desktop packages.
---

reader is a pnpm monorepo of four packages sharing one TypeScript codebase:

```
packages/
  core/     feed parsing (RSS 2.0 / Atom / RDF), HTML sanitization, shared
            types — pure logic, no I/O
  server/   Fastify API, background poller, ingestor engine, storage
            adapter (SQLite today, Postgres planned)
apps/
  web/      React + Vite SPA, PWA
  desktop/  Electron shell that forks the server on 127.0.0.1 with a
            random port
```

## Request flow

1. **Poller** fetches each feed with conditional GET (`etag` / `last-modified`)
   on adaptive intervals; failures back off exponentially.
2. **core** parses and normalizes the feed, rejecting malformed XML
   (doctype internal subsets, oversized input) before it reaches storage.
3. **Sanitizer** — article HTML passes through DOMPurify server-side before
   storage; the SPA never renders raw feed bytes. Summaries are plain text:
   any HTML-looking summary is promoted to `contentHtml` and sanitized.
4. **Storage** — SQLite via better-sqlite3 in embedded mode.
5. **API** — the SPA talks to `/api/v1/*` only; the server serves the built
   SPA when `READER_WEB_DIST` is set.

## Security posture

- The server binds **127.0.0.1** by default; exposure is an explicit opt-in.
- Outbound fetches (feed polling, ingestors) pass a guard that refuses
  private/loopback addresses unless `READER_ALLOW_PRIVATE_FETCH` is set — the
  SSRF guard required before any unauthenticated hosted exposure.
- The HTTP listener declares connection caps, body-size limits, and timeouts.
- Ingestor credentials are redacted at the API boundary; internal override
  keys are stripped from ingestor configs before storage.

## Conventions

- **Tests**: `pnpm -r test` — vitest everywhere. Unit tests for core logic;
  API tests boot the Fastify server in-process; platform ingestor tests hit
  live APIs and skip without credentials.
- **Migrations**: SQL migrations ship with the server package and run on
  boot.
- **Commits**: conventional commits, one logical unit per commit.

The design spec and plan history live in `docs/superpowers/`.
