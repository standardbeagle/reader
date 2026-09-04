---
title: Ingestors
description: Pull Mastodon, Bluesky, or Reddit timelines in as feeds, with optional LLM filtering and summarization.
---

Ingestors turn social timelines into ordinary feeds: the server polls the
platform on an interval and delivers statuses as articles in a synthetic feed
(`ingestor://mastodon/…`, `ingestor://bluesky/…`, `ingestor://reddit/…`).
Configure them under **Ingestors** in the sidebar.

## Platforms

| Platform | Auth |
| --- | --- |
| Mastodon | public timelines need no credentials |
| Bluesky | handle + app password |
| Reddit | client id/secret, optionally user/pass for authed reads |

Credentials can live in the server environment (see
[Configuration](/reader/configuration/)) or in the ingestor config. Either
way, credentials are redacted from API responses.

## Digest modes

- **realtime** — every poll delivers new statuses individually.
- **hourly** / **daily** — statuses accumulate and are delivered as one
  digest article per interval.

## LLM filtering and summarization

With an OpenRouter key configured (`OPENROUTER_API_KEY`), an ingestor can:

- **Filter** — score each status against a threshold and drop the noise
  (`filterThreshold`, 0–1). Filtering fails closed: without a key nothing is
  dropped.
- **Summarize** — hourly/daily digests get an LLM-written summary.

Use **Test** in the ingestor dialog to run one fetch cycle and see kept vs.
dropped statuses with their scores before committing to a config.

## Monitoring

Each ingestor reports `status` (ok / broken), `pendingCount` for digest
backlog, and its fetch interval. Ingestors honor the same outbound-fetch
guard as feed polling — private addresses are refused unless
`READER_ALLOW_PRIVATE_FETCH` is set.
