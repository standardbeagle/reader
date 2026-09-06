---
title: Reading articles
description: The three-pane UI — feeds, article list, and reader — plus subject filters and mobile behavior.
---

reader keeps the classic Google Reader layout: a **feeds sidebar**, an
**article list**, and the **reader pane**. Each column collapses to a rail
(`[` and `]` toggle the first two; every rail has a click target too) and can
be resized by dragging its edge.

## The article list

- Articles group by publication day — Today, Yesterday, then dated headers.
- Opening an article (click, or `j`/`k` navigation) marks it read immediately.
- Infinite scroll loads the next page before you reach the bottom; a
  **Load more** button covers keyboard and reduced-motion cases.

## Subject filters

Above the list, the feed's categories appear as toggle chips with unread
counts. Selecting a chip filters the list to that subject; **All** clears the
filter. Chips are per-feed — saved lists have their own membership instead.

## The reader pane

- **Reader / Embedded page** tabs: sanitized article content, or the original
  page in a sandboxed iframe when the feed only supplied a summary.
- Previous / next article links at the bottom, plus left/right swipe on touch
  devices with a directional push transition.
- A small dot at the left or right edge (and on the bottom navigation links)
  marks an unread neighbor. The **‹•›** header toggle restricts prev/next
  navigation — buttons, swipe, and `j`/`k` — to unread articles only.
- The article title links to the original URL in a new tab.

## Mobile

Below 700px the app switches to a single-pane flow: tap an article to open
the reader full-screen, **← Back to list** returns. Day headers appear in the
list and the feeds sidebar becomes a drawer behind the ☰ button.

## Install as an app

The web UI is a PWA. On desktop Chrome/Edge use the address-bar install icon
(or the ⤓ button in the header); on iOS Safari use Share → Add to Home
Screen; on Android use the ⋮ menu → Install app.
