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
| Mastodon | hashtags need no account; a connected account reaches instances that hide timelines from signed-out users, and unlocks **My home timeline** |
| Bluesky | handle + app password |
| Reddit | a connected Reddit account; without one, Reddit's public pages, which it often rate-limits |

### Connecting an account

Accounts are connected from the source's step in **Add source**, in a
sign-in window from the platform itself. Reader never sees your password.

- **Mastodon** — enter the instance and press **Connect**. Reader registers
  itself with the instance automatically.
- **Reddit** — create a **web app** at reddit.com/prefs/apps and set its
  redirect URI to the one the wizard shows
  (`<your reader address>/api/v1/oauth/callback`). Paste the app's client id
  and secret, then press **Sign in with Reddit**. One account serves every
  subreddit source.

**Accounts** in the sidebar lists connected accounts, removes ones no source
uses, and attaches an account to existing sources of its platform.

## Real-time delivery

Some sources also get posts the moment they are published, on top of the
regular polling:

- **Mastodon** sources with a connected account (home timeline or hashtag)
  use the instance's streaming API.
- **Bluesky** account sources use Jetstream. Search sources keep polling
  only, because Jetstream cannot filter by text.

Streamed posts are grouped for a few seconds before LLM filtering, so the
filter scores them together. Digest-mode sources collect them for the next
digest like any other post.

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
