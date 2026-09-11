---
title: Changelog
description: Notable changes to reader, newest first.
---

## Unreleased

- **JSON Feed** — feeds published as [JSON Feed](https://jsonfeed.org) 1.0
  or 1.1 now subscribe and refresh like RSS and Atom. Discovery listed them
  before but could not read them. Untitled microblog posts take their title
  from the start of the text.
- **YouTube subscriptions import** — **+ Add source → YouTube subscriptions**
  reads Google Takeout's `subscriptions.csv` and follows each channel's feed.
  YouTube has no feed for your subscriptions as a whole. Videos now show their
  thumbnail and description.
- **Feed sign-in** — subscribe to private feeds with a username and password,
  an access token, or an OAuth 2.0 sign-in. A feed's sign-in is sent only to
  that feed's host.
- **Connected accounts** — sign in to Mastodon and Reddit instead of storing
  passwords. **Accounts** in the sidebar manages them.
- **Mastodon home timeline** — follow your own home timeline once an account
  is connected.
- **Breaking: Reddit sign-in** — Reddit ingestors no longer accept a client
  secret, username or password, and the `REDDIT_*` variables are ignored. The
  upgrade deletes stored Reddit secrets. Connect a Reddit account and attach
  it under **Accounts**.
- **Fix:** Mastodon ingestors stopped receiving new posts after their first
  fetch. They now page forward.
- **Fix:** a feed redirect to another host no longer carries its sign-in along.
- **OPML import** — **+ Add source → OPML import** subscribes to every feed in
  an exported OPML file at once; duplicates are skipped, first fetches run in
  the background.
- **Static demo** — the full web app on bundled content at `/reader/demo/`;
  read, snooze, and list changes persist in the browser.
- **Combined AI view (composite ingestor)** — merge several feeds into one
  AI-filtered, summarized source.
- **Source wizard** — one guided flow for RSS feeds, OPML, combined views, and
  platform ingestors.
- **Pinboard view** — image-led card grid for the article list.
- **Unread neighbor indicators** — subtle dots at the reader's left/right edge
  and on the bottom navigation links show when the previous/next article is
  unread.
- **Unread-only navigation** — the **‹•›** header toggle makes prev/next
  (buttons, swipe, and `j`/`k`) jump between unread articles only; the choice
  persists across sessions.

## v0.2.0 — 2026-08

Snooze, saved lists, ingestors, and the production deployment.

- **Snooze** — hide articles until later today / tomorrow / next week; they
  stay unread and resurface on expiry. Keyboard: `s` `t` `w`, unsnooze `u`.
- **Saved lists** — permanent private or public collections; every public
  list is an RSS feed at `/lists/<token>.xml`.
- **Save-to-list keyboard shortcuts** — bind any key to a list and toggle
  membership in one press; configured in the All lists… dialog.
- **List chips in the reader** — toggle buttons like the subject filter, with
  overflow lists in a dropdown.
- **Keyboard navigation marks read** — `j`/`k` mark the landed-on article.
- **Ingestors** — Mastodon, Bluesky, and Reddit timelines as feeds, with
  digest modes (realtime / hourly / daily) and optional LLM filtering and
  summarization.
- **Security hardening** — SSRF guard on all outbound fetches, fail-closed
  LLM filtering without a key, connection/body caps on the HTTP listener,
  credential redaction and override-key stripping at the API boundary,
  hardened HTML sanitizer and XML parser.
- **Hosted deployment** — systemd user service on loopback behind a
  Cloudflare Access-protected tunnel.

## v0.1.0 — 2026-08

The reading core.

- RSS 2.0 / Atom / RDF parsing with conditional GET polling, adaptive
  refresh intervals, and exponential backoff.
- Server-side DOMPurify sanitization for every article body.
- Three-pane UI with day grouping, per-feed unread counts, mark-all-read.
- Electron desktop shell and web SPA from one codebase.
- Embedded SQLite storage; loopback-only server by default.
- Feed auto-discovery behind common blog URLs.
