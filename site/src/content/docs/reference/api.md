---
title: HTTP API
description: Every /api/v1 endpoint the SPA uses — feeds, articles, lists, snooze, ingestors, Libby holds, sign-in, real-time status — and the MCP endpoint.
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
| `GET /feeds` | All subscriptions with unread counts and fetch status. Each carries `category` (your own grouping, or `null`) and `kind` (`article` \| `podcast` \| `video` \| `social` \| `library`), which is derived from the feed's address and whether it carries playable media |
| `PATCH /feeds/:id` | Body `{"category": "…" \| null}` — file the feed under a category, or clear it. At most 60 characters |
| `POST /feeds` | Subscribe. Body `{"url": "…"}`. Returns `201` with the feed, or `200` with a `feeds[]` choice list when the URL hosts several feeds. With `"credentialId"`, discovery is skipped: the URL must be the feed itself, on the credential's origin |
| `POST /feeds/discover` | Preview discoverable feeds at a URL without subscribing |
| `POST /feeds/import` | OPML import. Body `{"opml": "<xml…>"}`. Returns `201` with `added[]` and `skipped[]`; first fetches run in the background. Each feed takes the OPML folder it sat in as its category. Capped at 500 feeds |
| `POST /feeds/import/youtube` | YouTube import. Body `{"csv": "…"}` — Google Takeout's `subscriptions.csv`. Each channel becomes its `feeds/videos.xml?channel_id=` feed. Same response and cap as OPML import |
| `DELETE /feeds/:id` | Unsubscribe |
| `POST /feeds/:id/refresh` | Poll now. Returns `{"newArticles": n}` |
| `POST /feeds/:id/mark-all-read` | Mark every article in the feed read |

## Articles

| Endpoint | Description |
| --- | --- |
| `GET /articles` | Cursor-paginated list of a stream. Filters, all optional and combined: `feed_id`, `list_id`, `feed_category`, `feed_kind`, `category` (an article subject), `media` (`any` \| `audio` \| `video` — playable articles only), `unread=1`. `order` is `newest` (default), `oldest`, or `position` (a manual list's own order, the default with `list_id`). Paging: `before`, `before_id`, `limit` (max 200). Returns `{articles, nextCursor}`; an unknown filter value is `400 invalid_filter` |
| `GET /articles/:id` | Full record, including `listIds` and `snoozedUntil` |
| `POST /articles/:id/read` | Body `{"read": true \| false}` |
| `POST /articles/:id/played` | Body `{"played": true \| false}` (default `true`). Played through: the article is also marked read and drops off every playlist. `false` clears the record but does not put it back on a manual playlist |
| `POST /articles/:id/snooze` | Body `{"until": ISO8601 \| null}` — `null` unsnoozes |
| `GET /articles/:id/embeddable` | Whether the article's page can be shown in an iframe: `{"embeddable": true \| false \| null, "reason"}`. Reads the page's `X-Frame-Options` and CSP `frame-ancestors`; `null` when the page could not be checked. Cached per URL |
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
| `GET /lists` | All lists and playlists, each with `kind` (`list` \| `playlist`), `rule` (`null` for a manual one), `progress` (`{articleId, seconds}` or `null`) and `itemCount` |
| `POST /lists` | Create. Body `{"title", "visibility": "public" \| "private", "kind"?: "list" \| "playlist", "rule"?}`. With a `rule` it is dynamic. `kind` defaults to `list` and cannot be changed later |
| `PUT /lists/:id/progress` | Body `{"articleId", "seconds"}` — where a playlist is playing. `409 list_permanent` for a list |
| `PATCH /lists/:id` | Rename, change visibility, or replace a dynamic list's rule. `409 list_manual` when a rule is sent for a manual list |
| `DELETE /lists/:id` | Delete the list (articles are untouched) |
| `POST /lists/:id/items` | Body `{"articleId"}` — save an article to the end of a manual list. `409 list_dynamic` for a dynamic one |
| `PUT /lists/:id/items` | Body `{"articleIds": [...]}` — replace a manual list's articles with exactly these, in this order (at most 1000). All-or-nothing: `404` names any unknown id |
| `DELETE /lists/:id/items/:articleId` | Remove an article |
| `GET /lists/:token.xml` | RSS for a public list — the sharing URL |

A **list** is permanent. A **playlist** is a named play queue: an article
drops off it once played (`POST /articles/:id/played`), and `progress` records
what it was playing. An emptied playlist is kept. A dynamic playlist's rule
skips articles that have been played; the same rule on a list does not.

A **manual** list holds the articles you saved, in the
order you saved or arranged them. A **dynamic** list holds a `rule` instead and
contains whatever matches it at the moment it is read:

```json
{ "feedIds": ["…"], "feedCategory": "Tech", "feedKind": "podcast",
  "category": "Science", "media": "audio", "unreadOnly": true,
  "maxAgeDays": 30, "order": "oldest" }
```

Every field is optional and all set fields must match. An unknown field is
`400 invalid_rule` rather than ignored. A list keeps the kind it was created as.

## Libby holds

| Endpoint | Description |
| --- | --- |
| `GET /libby` | The linked account as of the last sync, with `syncEnabled` (the setting below): `{"linked": false}`, or `cards`, `holds` (position, estimated wait, `ready`, dates, card), `lastSyncedAt`, `lastError`, `signInExpiresAt`, `needsRelink`, and the `feedId` of the hold notices |
| `POST /libby/link` | Body `{"code": "8 digits"}` — Libby's setup code. Links the account, or replaces a lapsed sign-in. `422 libby_code_rejected` when Libby refuses the code |
| `DELETE /libby` | Unlink: removes the notices feed and the stored sign-in. Holds in Libby are untouched |
| `POST /libby/sync` | Sync now. `502 libby_failed` carries the unchanged account under `libby` |
| `GET /libby/search` | Query `q`, optional `card_id` — search that library's public catalog |
| `POST /libby/holds` | Body `{"cardId", "titleId"}` — place a hold |
| `DELETE /libby/holds/:cardId/:titleId` | Cancel a hold |
| `POST /libby/holds/:cardId/:titleId/suspend` | Body `{"days": 0–365}` — suspend, or `0` to resume |
| `POST /libby/holds/:cardId/:titleId/borrow` | Borrow a ready hold. `409 hold_not_ready` otherwise |

Every change answers with the re-synced account. `409 libby_relink` means the
sign-in has lapsed and only a new setup code will revive it.

`403 libby_sync_disabled` answers linking, syncing and every hold change while
the `libbySyncEnabled` setting is off; reading `GET /libby`, unlinking and the
catalog search still work.

## Settings

| Endpoint | Description |
| --- | --- |
| `GET /settings` | `{"libbySyncEnabled": false}` — whether reader may call Libby's private sync API. Off by default |
| `PATCH /settings` | Body `{"libbySyncEnabled": true \| false}`. Turning it off pauses a linked account without unlinking it |

## MCP

`POST /mcp` (not under `/api/v1`) speaks the Model Context Protocol over
Streamable HTTP, statelessly: one JSON-RPC message in, one JSON answer out.
Tools: `feeds_list`, `feed_set_category`, `articles_list`, `article_get`,
`article_set_read`, `lists_list`, `list_create`, `list_update`, `list_delete`,
`list_set_items`, `list_add_items`, `list_remove_items`, `article_set_played`, `libby_holds_list`,
`libby_search`. Each one calls the routes above, so the same validation and
errors apply. The Libby tools are read-only.

## Ingestors

| Endpoint | Description |
| --- | --- |
| `GET /ingestors` | All ingestors with status and pending digest counts |
| `POST /ingestors` | Create. Body: `kind` (`mastodon` \| `bluesky` \| `reddit` \| `composite`; a `libby` ingestor is created by `POST /libby/link`), `config`, optional `fetchIntervalMin`, `digestMode` (`realtime` \| `hourly` \| `daily`), `filterThreshold`, `llmEnabled` |
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
