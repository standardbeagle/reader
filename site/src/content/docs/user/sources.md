---
title: Adding sources
description: Subscribe by URL, sign in to private feeds, import from OPML or YouTube, and how reader fills in history.
---

Every source starts at **+ Add source** in the sidebar. Pick a kind and the
wizard walks you through the rest.

## Subscribe by URL

Choose **RSS / Atom feed** and paste either a feed address or a site's home
page. From a home page, the server finds the site's feeds: `<link
rel="alternate">` tags first, then common paths such as `/feed` and
`/feed.json`. If it finds more than one, you pick.

reader reads these formats:

| Format | Notes |
| --- | --- |
| RSS 2.0, RSS 1.0 (RDF), Atom | Categories, enclosures, Media RSS thumbnails, and YouTube's `media:group` descriptions are all read |
| [JSON Feed](https://jsonfeed.org) 1.0 and 1.1 | Posts without a title take the first line of their text, cut at a word boundary |
| IndieWeb [h-feed](https://microformats.org/wiki/h-feed) | An HTML page whose posts are marked up as `h-entry`. Discovery lists it after any RSS, Atom or JSON feed the site also offers, because those usually carry the full post |
| Podcast feeds | Episodes get a player, chapters and transcripts. See [Podcasts](/reader/user/podcasts/) |

## Private feeds

Some feeds need a sign-in: a paid newsletter, a members-only podcast, an
internal wiki. Under **Sign-in** in the same step, choose one of:

- **Username and password.** HTTP Basic authentication.
- **Access token.** Sent as `Authorization: Bearer …`.
- **OAuth 2.0 sign-in.** Enter the provider's authorize URL, token URL and
  client id (and a client secret if the provider issued one), then press
  **Sign in**. The provider's page opens in a pop-up. reader always uses
  PKCE and refreshes the token on its own when it expires.

With a sign-in, paste the feed's own address. reader skips discovery and
refuses to send the sign-in to any other host, including when a feed
redirects somewhere else. If the first fetch fails, a username/password or
token sign-in is deleted again, so a typo leaves nothing behind.

Sign-ins and connected accounts are listed under **Accounts** in the
sidebar. An account that sources still use cannot be removed until you
remove those sources.

## Import from another reader (OPML)

**+ Add source → OPML import** takes the OPML file other readers export
(Feedly, Inoreader, FreshRSS and most others) and subscribes to every feed
in it at once. Feeds you already follow are skipped. One import adds at most
500 feeds. The first fetches run in the background, so a large import fills
in over the next few minutes.

## Import your YouTube subscriptions

YouTube has no feed for your subscriptions as a whole. It does publish a feed
for each channel, so reader follows those:

1. Go to [takeout.google.com](https://takeout.google.com), deselect all, and
   select **YouTube and YouTube Music**.
2. Under **All YouTube data included**, keep only **subscriptions**, then
   export.
3. Unzip the download and pick
   `YouTube and YouTube Music/subscriptions/subscriptions.csv` under
   **+ Add source → YouTube subscriptions**.

Each channel becomes a subscription to
`https://www.youtube.com/feeds/videos.xml?channel_id=…`. Takeout translates
the file's header row into your account language; reader recognizes it
either way. A file with a row that is not a channel id is rejected as a
whole, so picking the wrong CSV cannot import half of it. Channel feeds
carry about the last 15 videos each, with thumbnails and descriptions.

## History

Most feeds carry only their newest items. When a feed links to older pages
(RFC 5005 `rel="next"` or `rel="prev-archive"`, or JSON Feed's `next_url`),
a new subscription walks back up to ten pages after it appears in the
sidebar. Those older items arrive already marked read so they don't bury
what's new.

## How often feeds refresh

Each feed has its own interval between 15 minutes and a day. It halves when
a fetch finds new items and doubles when it doesn't. reader also follows
what the publisher asks for:

- It never polls faster than the feed's `<ttl>`, its syndication-module
  `updatePeriod`/`updateFrequency`, or the response's
  `Cache-Control: max-age`.
- A `429` or `503` with `Retry-After` pauses scheduled polls until then
  (at most a day). **↻ Refresh** on the feed still fetches right away.
- Fetches send `If-None-Match` / `If-Modified-Since`, so an unchanged feed
  costs one `304`.
- A failing feed backs off exponentially and shows ⚠ after ten failures in a
  row. It keeps being retried and recovers on its own.

Podcasts announced on Podping, and social sources with real-time delivery,
update sooner than their interval. See [Podcasts](/reader/user/podcasts/) and
[Ingestors](/reader/user/ingestors/).
