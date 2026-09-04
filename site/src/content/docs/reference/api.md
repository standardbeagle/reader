---
title: HTTP API
description: Every /api/v1 endpoint the SPA uses — feeds, articles, lists, snooze, ingestors.
---

All endpoints are JSON under `/api/v1`. Errors return
`{"error": {"code": "...", "message": "..."}}` with a 4xx/5xx status. The
server binds 127.0.0.1 by default; see [Hosting](/reader/hosting/).

## Health

| Endpoint | Description |
| --- | --- |
| `GET /health` | Liveness probe, returns `{"ok": true}` |

## Feeds

| Endpoint | Description |
| --- | --- |
| `GET /feeds` | All subscriptions with unread counts and fetch status |
| `POST /feeds` | Subscribe. Body `{"url": "…"}`. Returns `201` with the feed, or `200` with a `feeds[]` choice list when the URL hosts several feeds |
| `POST /feeds/discover` | Preview discoverable feeds at a URL without subscribing |
| `DELETE /feeds/:id` | Unsubscribe |
| `POST /feeds/:id/refresh` | Poll now. Returns `{"newArticles": n}` |
| `POST /feeds/:id/mark-all-read` | Mark every article in the feed read |

## Articles

| Endpoint | Description |
| --- | --- |
| `GET /articles` | Cursor-paginated list. Query: `feed_id`, `list_id`, `category`, `before`, `before_id`, `limit`. Returns `{articles, nextCursor}` |
| `GET /articles/:id` | Full record, including `listIds` and `snoozedUntil` |
| `POST /articles/:id/read` | Body `{"read": true \| false}` |
| `POST /articles/:id/snooze` | Body `{"until": ISO8601 \| null}` — `null` unsnoozes |

## Categories

| Endpoint | Description |
| --- | --- |
| `GET /categories` | Subject counts. Query: `feed_id` to scope to one feed |

## Lists

| Endpoint | Description |
| --- | --- |
| `GET /lists` | All saved lists |
| `POST /lists` | Create. Body `{"title", "visibility": "public" \| "private"}` |
| `DELETE /lists/:id` | Delete the list (articles are untouched) |
| `POST /lists/:id/items` | Body `{"articleId"}` — save an article |
| `DELETE /lists/:id/items/:articleId` | Remove an article |
| `GET /lists/:token.xml` | RSS for a public list — the sharing URL |

## Ingestors

| Endpoint | Description |
| --- | --- |
| `GET /ingestors` | All ingestors with status and pending digest counts |
| `POST /ingestors` | Create. Body: `kind` (`mastodon` \| `bluesky` \| `reddit`), `config`, optional `fetchIntervalMin`, `digestMode` (`realtime` \| `hourly` \| `daily`), `filterThreshold`, `llmEnabled` |
| `PATCH /ingestors/:id` | Update interval, digest mode, threshold, LLM flag |
| `DELETE /ingestors/:id` | Remove the ingestor |
| `POST /ingestors/test` | Run one fetch cycle; returns kept and dropped statuses with scores |

Credential fields in ingestor configs are accepted but redacted from every
response.
