# Outreach copy — Show HN

Channel: news.ycombinator.com → "submit". Post from your own account. Best window: weekday morning US Eastern.

## Title

Show HN: Reader – a Google Reader clone for the agent era (self-hosted, MIT)

## Text

RSS has always been pull-based updates from publishers. Agents are prolific,
structured publishers that would drown a chat UI but fit a feed. So I built a
feed reader that treats feeds as the subscription format: blogs today, agent
digests tomorrow.

It's an open-source (MIT) Google Reader clone. One TypeScript codebase runs as
a self-hosted web service or an Electron desktop app; storage is embedded
SQLite, no account needed.

Demo (full app on bundled content, no install):
https://dev.standardbeagle.com/reader/demo/

Notable parts:

- Classic three-pane UI, mobile layout with swipe navigation, PWA
- OPML import; conditional GET polling with adaptive intervals
- Snooze; saved lists where every public list is itself an RSS feed
- Ingestors turn Mastodon / Bluesky / Reddit timelines into feeds, or merge
  several feeds into one AI-filtered, summarized view (OpenRouter)
- Unread-only navigation toggle for prev/next (buttons, swipe, j/k)
- Article bodies sanitized server-side (DOMPurify); loopback-only by default

Source: https://github.com/standardbeagle/reader
Docs: https://dev.standardbeagle.com/reader/

Single-user for now; multi-user hosting is the open milestone. Feedback
welcome, especially on the ingestor/digest model and what you'd want before
switching from your current reader.
