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

## Ingestor credentials (optional)

Per-platform auth can come from the environment or the ingestor config;
either way, values are redacted from API responses.

| Variable | Platform |
| --- | --- |
| `BLUESKY_IDENTIFIER`, `BLUESKY_APP_PASSWORD` | Bluesky |
| `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` | Reddit app auth |
| `REDDIT_USERNAME`, `REDDIT_PASSWORD` | Reddit authenticated reads |

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
