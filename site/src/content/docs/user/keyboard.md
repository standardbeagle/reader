---
title: Keyboard shortcuts
description: Every built-in key, plus how to bind your own save-to-list shortcuts.
---

Press <kbd>?</kbd> anywhere in the app to see the live cheat sheet.

## Built-in shortcuts

| Key | Action |
| --- | --- |
| `j` / `k` | Next / previous article — the article you land on is marked read |
| `r` | Refresh the selected feed |
| `o` | Open the article's original link in a new tab |
| `s` | Snooze the open article until **later today** (+3 hours) |
| `t` | Snooze until **tomorrow 9:00** |
| `w` | Snooze until **next week** (same weekday, 9:00) |
| `u` | Unsnooze the open article |
| `[` / `]` | Collapse / expand the feeds and article-list columns |
| `?` | Toggle the shortcut help popover |
| `Esc` | Close the shortcut help popover |

Shortcuts never fire while you are typing in an input, and modal dialogs
(add feed, ingestor, feed picker) own the keyboard while open.

## Save-to-list keys

Any list can be bound to a single key. Pressing that key toggles the current
article's membership in the list — one press to save, one more to remove.

1. Open an article and choose **All lists…** in the list chip row.
2. Type a key into the `key` input beside the list.
3. Press the bound key anywhere to save or unsave the article.

Rules:

- Built-in keys (`j k r o s t w u [ ] ?`) are reserved and rejected.
- One list per key — binding a key to a second list steals it from the first.
- Bindings live in `localStorage` (`reader-list-shortcuts-v1`) on each device,
  and sync across tabs.

Bound keys show as badges on the list chips in the reader, and appear in the
`?` cheat sheet.
