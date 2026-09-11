---
title: Saved lists
description: Keep articles in lists; make a list public and it becomes a curated feed others can follow.
---

Lists are permanent collections of articles, separate from read state and
snoozes. Save an article from the chip row in the reader (one click), the
**More lists ▾** dropdown, or the full **All lists…** dialog.

## Curate for others with public lists

A public list turns reader into a curation engine. You read far more than
anyone you know. Make a list for a topic, save the things in it you think
others would like, from any feed you follow, and share the list. Friends
subscribe to your picks instead of to all your sources.

Every list can be **public**. A public list is an RSS feed at:

```
/lists/<token>.xml
```

Anyone with the URL can subscribe in any feed reader, no reader account
involved. The **⧉** button next to a public list copies its feed URL. The
token is generated with the list and is the only thing protecting it, so
treat the URL as a capability. Private lists are only visible in your own
UI.

The [demo](/reader/demo/) has one: **Neat stuff**, a few curiosities picked
from across its feeds.

## Viewing a list

Each list appears in the sidebar under **Lists**. Opening it shows its
articles with the same day grouping, filters, and keyboard navigation as feed
views. Removing an article from the list does not delete it from its feed.

## Managing lists

The **All lists…** dialog is the management surface:

- Toggle membership for the current article (checkboxes).
- Create a new list, choosing private or public.
- Bind keyboard shortcuts per list — see [Keyboard shortcuts](/reader/user/keyboard/).

The API is fully scriptable too: see [HTTP API](/reader/reference/api/) for
`POST /api/v1/lists`, `POST /api/v1/lists/:id/items`, and friends. An agent
can curate the same way you do: add items to a public list through the API,
and everyone following the list's feed gets them. The list token only grants
read access to that feed.
