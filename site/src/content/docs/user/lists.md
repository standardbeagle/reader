---
title: Saved lists
description: Permanent article collections — private by default, public lists are RSS feeds you can share.
---

Lists are permanent collections of articles, separate from read state and
snoozes. Save an article from the chip row in the reader (one click), the
**More lists ▾** dropdown, or the full **All lists…** dialog.

## Public lists are feeds

Every list can be **public**. A public list exposes an RSS feed at:

```
/lists/<token>.xml
```

Anyone with the URL can subscribe — no reader account involved. The token is
generated with the list; treat it as a capability URL. Private lists are only
visible in your own UI.

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
`POST /api/v1/lists`, `POST /api/v1/lists/:id/items`, and friends. Because a
public list is just an RSS feed, an agent can *publish* to your reading
stack by writing a feed you subscribe to — or by holding a list token.
