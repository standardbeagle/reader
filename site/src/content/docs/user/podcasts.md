---
title: Podcasts
description: Play episodes in the reader, jump by chapter or transcript line, and get new episodes as soon as Podping announces them.
---

Subscribe to a podcast like any other feed: paste its RSS address, or the
show's website, under **+ Add source → RSS / Atom feed**. reader treats an
item as an episode when its enclosure (or a JSON Feed attachment) is audio
or video. Episodes are marked **♪** (audio) or **▶** (video) in the article
list.

## Listening

Opening an episode puts a player above the show notes. The browser streams
the file straight from the podcast host; nothing is downloaded to the
server. The episode's artwork (`itunes:image`) is its picture, falling back
to the show's artwork.

## Chapters and transcripts

Shows that publish [Podcasting 2.0](https://podcastindex.org/namespace/1.0)
tags get two extra sections under the player:

- **Chapters** (`<podcast:chapters>`). Click a chapter to jump to it.
- **Transcript** (`<podcast:transcript>`). WebVTT, SRT and Podcast Index
  JSON transcripts show one line per cue with its time and speaker; click a
  line to jump there. HTML transcripts are shown sanitized, and anything else
  as plain text. When a show offers several formats, reader picks a timed
  one.

Both load only when you open their section. The server fetches the file from
the podcast's host and hands the browser a cleaned-up version, so a
publisher's file never runs in your page.

## New episodes, sooner

Podcast hosts announce new episodes on [Podping](https://podping.org). While
you follow at least one podcast, reader keeps a WebSocket open to a public
Podping relay. When an announcement names a show you follow, that feed is
refreshed right away instead of waiting for its polling interval. A show is
refreshed at most once a minute this way, because live shows announce often.

The connection is outbound only, so it works on a server nobody can reach.
The default relay (`wss://api.livewire.io/ws/podping`) is run by a third
party; set `READER_PODPING_URL` to use another, or `READER_PODPING=off` to
turn it off (see [Configuration](/reader/configuration/)).
`GET /api/v1/realtime` shows whether the relay is connected and how many
announcements matched your feeds.

## Upgrading from an older version

Before these changes, reader stored an episode's audio file as the article's
image, which showed up as a broken picture. Upgrading moves those links to
the player.
