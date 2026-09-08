# Outreach copy — ALL-about-RSS

Channel: PR to AboutRSS/ALL-about-RSS, adding one line under `### Self Hosted Readers`.
The maintainer edits the line into their telegram-ref format later; keep the PR minimal.

## README.md line to add (end of Self Hosted Readers)

```markdown
- [reader](https://dev.standardbeagle.com/reader/) — Google Reader clone: three-pane UI, OPML import, snooze, saved lists with public RSS, Mastodon/Bluesky/Reddit ingestors with optional LLM filtering; Electron desktop or hosted web service from one TypeScript codebase. ([Demo](https://dev.standardbeagle.com/reader/demo/)) [![Open-Source Software][oss icon]](https://github.com/standardbeagle/reader)![Freeware][freeware icon]![AI][AI icon]
```

## PR title

Add reader to Self Hosted Readers

## PR body

reader is an open-source (MIT) RSS/Atom reader. It runs self-hosted as a web service or as an Electron desktop app from the same TypeScript codebase.

Why it fits the Self Hosted Readers section:

- Google-Reader-style three-pane UI, plus a mobile layout with swipe navigation
- OPML import
- snooze, saved lists (public lists are RSS feeds)
- ingestors pull Mastodon / Bluesky / Reddit timelines in as feeds, or merge several feeds into one AI-filtered view
- local-first SQLite

Demo (no install): https://dev.standardbeagle.com/reader/demo/
Docs: https://dev.standardbeagle.com/reader/
Source: https://github.com/standardbeagle/reader
