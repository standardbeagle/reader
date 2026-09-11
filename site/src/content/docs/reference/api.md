---
title: HTTP API
description: Every /api/v1 endpoint the SPA uses — feeds, articles, lists, snooze, ingestors, sign-in, and real-time status.
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
| `POST /feeds` | Subscribe. Body `{"url": "…"}`. Returns `201` with the feed, or `200` with a `feeds[]` choice list when the URL hosts several feeds. With `"credentialId"`, discovery is skipped: the URL must be the feed itself, on the credential's origin |
| `POST /feeds/discover` | Preview discoverable feeds at a URL without subscribing |
| `POST /feeds/import` | OPML import. Body `{"opml": "<xml…>"}`. Returns `201` with `added[]` and `skipped[]`; first fetches run in the background. Capped at 500 feeds |
| `POST /feeds/import/youtube` | YouTube import. Body `{"csv": "…"}` — Google Takeout's `subscriptions.csv`. Each channel becomes its `feeds/videos.xml?channel_id=` feed. Same response and cap as OPML import |
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
| `GET /articles/:id/transcript` | Podcast transcript, fetched from the publisher and normalized: `{"kind": "cues", "cues": [{start, text, speaker}]}`, `{"kind": "html", html}` or `{"kind": "text", text}`. `404` when the episode has none, `502 transcript_unavailable` when the file cannot be fetched or read |
| `GET /articles/:id/chapters` | Podcast chapters: `{"chapters": [{start, title, url, img}]}`. `404` / `502 chapters_unavailable` as above |

Articles carry `media` (`{url, type}` of a playable enclosure) in lists too;
`transcript` and `chaptersUrl` come with the full record.

## Real-time

| Endpoint | Description |
| --- | --- |
| `GET /realtime` | Outbound stream state: each socket's name, redacted URL, `state` (`connecting` \| `open` \| `waiting` \| `closed`), message and reconnect counts, last error; plus Podping, Jetstream and Mastodon summaries |

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
| `POST /ingestors` | Create. Body: `kind` (`mastodon` \| `bluesky` \| `reddit` \| `composite`), `config`, optional `fetchIntervalMin`, `digestMode` (`realtime` \| `hourly` \| `daily`), `filterThreshold`, `llmEnabled` |
| `PATCH /ingestors/:id` | Update interval, digest mode, threshold, LLM flag. `credentialId` attaches a connected account of the ingestor's platform; `null` detaches it |
| `DELETE /ingestors/:id` | Remove the ingestor |
| `POST /ingestors/test` | Run one fetch cycle; returns kept and dropped statuses with scores |

Credential fields in ingestor configs are accepted but redacted from every
response. Mastodon and Reddit configs take a `credentialId` instead of
secrets; Mastodon also takes `"timeline": "home"`, which requires one.

## Credentials and sign-in

| Endpoint | Description |
| --- | --- |
| `GET /credentials` | Connected accounts and feed sign-ins: `provider`, `kind` (`basic` \| `bearer` \| `oauth2`), `label`, `origin`, `usedBy`. Never the secret |
| `POST /credentials` | Basic or bearer sign-in for a feed. Body `{"kind": "basic", "url", "username", "password"}` or `{"kind": "bearer", "url", "token"}`. Bound to the URL's origin |
| `DELETE /credentials/:id` | Remove. `409 credential_in_use` while a feed or ingestor uses it |
| `POST /oauth/start` | Begin an OAuth sign-in. Body `{"provider": "mastodon", "instance"}`, `{"provider": "reddit", "clientId", "clientSecret"}`, or `{"provider": "generic", "feedUrl", "authorizeUrl", "tokenUrl", "clientId", "clientSecret"?, "scope"?}`. Returns `{"authorizeUrl"}`. Must come from the browser: the redirect URI is built from the `Origin` header |
| `GET /oauth/callback` | Where the provider sends the browser back. Stores the credential and posts the result on the `reader-oauth` BroadcastChannel |
