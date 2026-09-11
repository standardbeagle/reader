---
title: Configuration
description: Environment variables, the database location, and secret handling.
---

reader is configured through environment variables only — no config file for
the server. Defaults are loopback-safe.

## Server

| Variable | Default | Purpose |
| --- | --- | --- |
| `READER_PORT` | `3737` | HTTP port. Always binds `127.0.0.1` |
| `READER_DB` | `~/.local/share/reader/reader.db` (hosted) | SQLite database path |
| `READER_WEB_DIST` | unset | When set, the server serves this built SPA directory |

## Networking and LLM

| Variable | Default | Purpose |
| --- | --- | --- |
| `READER_ALLOW_PRIVATE_FETCH` | unset | Set to let the poller and ingestors fetch private/loopback addresses. Leave unset in production |
| `OPENROUTER_API_KEY` | unset | Enables LLM filtering and digest summaries for ingestors. Without it, filtering fails closed (nothing is dropped) |
| `READER_LLM_MODEL` | server default | OpenRouter model for filter/summarize |

## Real-time streams

Reader opens outbound WebSockets. Nothing connects in, so they work on a
loopback-only server. Each stream opens only while some subscription needs it,
and polling continues underneath. `GET /api/v1/realtime` shows their state.

| Variable | Default | Purpose |
| --- | --- | --- |
| `READER_PODPING` / `READER_PODPING_URL` | on / `wss://api.livewire.io/ws/podping` | Podping relay for podcast update notifications. Set `READER_PODPING=off` to disable. The default relay is run by a third party (Livewire) |
| `READER_JETSTREAM` / `READER_JETSTREAM_URL` | on / `wss://jetstream2.us-east.bsky.network/subscribe` | Bluesky Jetstream for account sources. `off` disables |
| `READER_MASTODON_STREAMING` | on | Mastodon streaming API for sources with a connected account. `off` disables |

## Sign-ins and connected accounts

Mastodon and Reddit accounts, and sign-ins for private feeds, are connected
in the web UI (**Add source**, **Accounts**) and stored in the local
database. They are not configured through the environment. Each one is bound
to a single origin: its password, token or OAuth access token is sent only
there. There is one exception: a Mastodon token may also go to that
instance's streaming host, if it is the same host or a subdomain of it (such
as `streaming.mastodon.social`). An OAuth refresh token and client secret go
only to the provider's token endpoint. Redirects to another host drop the
sign-in. Secrets are stored in plaintext in the SQLite file, so protect it
like the `env` file. API responses never include them.

Bluesky still reads its app password from the ingestor config or the
environment:

| Variable | Platform |
| --- | --- |
| `BLUESKY_IDENTIFIER`, `BLUESKY_APP_PASSWORD` | Bluesky |

`REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USERNAME` and
`REDDIT_PASSWORD` are no longer read. Connect a Reddit account instead.

## Secret hygiene

On the hosted deployment, secrets live in `~/.config/reader/env` (user-managed,
mode `0600`) and are loaded by the systemd unit. Rules worth keeping:

- Never paste secret values into chat, tickets, or logs — reference them by
  name.
- Tunnel credentials (`~/.config/cloudflared/reader.json`) stay outside every
  working tree and are never committed.
- Provisioning that needs a Cloudflare API token runs from a workstation,
  never from the hosting box.

## Browser-side settings

Two small `localStorage` stores belong to the web UI:

- `reader-column-layout-v1` — column widths and collapsed states.
- `reader-list-shortcuts-v1` — save-to-list keyboard bindings.

Both are per-device; clearing site data resets them.
