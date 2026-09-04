---
title: Snooze
description: Hide an article until later — it stays unread and resurfaces on its own.
---

Snoozing hides an article from the default list until a time you pick. The
article **stays unread** the whole time; when the snooze expires it reappears
as unread, so nothing is silently dropped.

## Presets

Three presets, available from the **Snooze** button in the reader or straight
from the keyboard:

| Preset | Key | Until |
| --- | --- | --- |
| Later today | `s` | now + 3 hours |
| Tomorrow | `t` | tomorrow, 9:00 local time |
| Next week | `w` | same weekday next week, 9:00 local time |

Press `u` to unsnooze early. The reader shows a "Snoozed until …" badge while
an article is hidden, and the snooze menu offers **Unsnooze** for articles
with an active snooze.

## Where snoozed articles go

While snoozed, the article is excluded from the unread list and from the
feed's unread count, so your counts stay honest. Feeds, lists, and the API
still return the article — snooze only affects visibility ordering.
