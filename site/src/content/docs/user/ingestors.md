---
title: Ingestors
description: Pull Mastodon, Bluesky, or Reddit timelines in as feeds, merge feeds into one AI-filtered view, and get social posts in real time.
---

Ingestors turn social timelines into ordinary feeds. The server fetches the
platform on an interval, can filter and summarize the posts with an LLM, and
delivers what it keeps as articles in a synthetic feed
(`ingestor://mastodon/…`, `ingestor://bluesky/…`, `ingestor://reddit/…`).
Create one under **+ Add source** by picking its platform.

## Platforms

| Platform | What it follows | Sign-in |
| --- | --- | --- |
| Mastodon | A hashtag on an instance, or your **home timeline** | Hashtags work signed out. A connected account reaches instances that hide timelines from signed-out visitors, and is required for the home timeline |
| Bluesky | One account's posts (handle), or a search | Optional: your identifier and an app password |
| Reddit | A subreddit, sorted by new, hot or top | A connected Reddit account. Without one, reader reads Reddit's public pages, which Reddit often rate-limits or blocks |
| Combined AI view | Several of your RSS feeds merged into one source | None; it reads feeds you already follow |

## Connecting an account

Mastodon and Reddit accounts are connected from the platform's step in
**+ Add source**. The platform's own sign-in page opens in a pop-up; reader
receives a token and never sees your password.

- **Mastodon.** Enter the instance, then press **Connect a … account**.
  reader registers itself with the instance automatically.
- **Reddit.** Reddit has no automatic registration, so create a **web app**
  at reddit.com/prefs/apps and set its redirect URI to the one the wizard
  shows (`<your reader address>/api/v1/oauth/callback`). Paste the app's
  client id and secret, then press **Sign in with Reddit**. One account
  serves every subreddit you follow, and its token renews itself.

**Accounts** in the sidebar lists connected accounts and removes ones no
source uses. It also attaches an account to sources of its platform that
don't have one yet. That is how Reddit sources created before connected
accounts get signed in again: the upgrade deleted the client secrets and
passwords they used to store.

## Real-time delivery

Some sources also receive posts the moment they are published, on top of
their regular fetches:

- **Mastodon** sources with a connected account, home timeline or hashtag,
  use the instance's streaming API.
- **Bluesky** account sources share one connection to Bluesky's Jetstream.
  Search sources are fetched on their interval only, because Jetstream
  cannot filter by text.

Streamed posts wait about five seconds so the LLM filter scores them
together instead of one at a time. A post that arrives by stream and again
by a fetch is kept once. `GET /api/v1/realtime` shows each connection's
state, and each can be turned off (see [Configuration](/reader/configuration/)).

## Digest modes

- **realtime.** Kept posts become articles as soon as they are fetched or
  streamed.
- **hourly** / **daily.** Posts collect and are filtered together once per
  interval. Each kept post still becomes its own article, dated at delivery.

## LLM filtering and summarization

With an OpenRouter key (`OPENROUTER_API_KEY`) on the server, an ingestor
with **LLM filtering & summaries** on:

- **Filters.** Every post gets a score from 0 to 10; posts below the
  ingestor's threshold (the **Keep items scoring at least** slider) are
  dropped.
- **Summarizes.** Every kept post gets a clean title and a short summary,
  with a link to the original.

Without a key, reader refuses to create an ingestor that has LLM filtering
on, so posts are never delivered unfiltered by accident. Turn filtering off
to deliver posts as they are. If the key disappears later, fetched posts
stay queued and the ingestor reports the error until a key is back.

Press **Test** on the wizard's last step to run one fetch and see which
posts would be kept or dropped, with their scores, before subscribing.

## Monitoring

Each ingestor reports `status` (`ok` or `broken`), `pendingCount` for posts
waiting for a digest, and its fetch interval. After ten failed runs in a row
it is marked broken. Ingestors pass the same outbound guard as feed polling:
private and loopback addresses are refused unless
`READER_ALLOW_PRIVATE_FETCH` is set.
