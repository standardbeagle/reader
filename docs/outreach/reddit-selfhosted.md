# Outreach copy — r/selfhosted

Channel: reddit.com/r/selfhosted, flair "Self-Promotion" (allowed on Saturdays per sub rules — check current rules before posting). Post from your own account.

## Title

reader: a self-hosted, open-source Google Reader clone — RSS/Atom + Mastodon/Bluesky/Reddit timelines, OPML import, LLM filtering (demo inside)

## Body

I built reader because I wanted the Google Reader workflow back — self-hosted, and able to follow more than blogs.

**What it is:** an open-source (MIT) RSS/Atom reader. One TypeScript codebase runs as a hosted web service or an Electron desktop app. Storage is embedded SQLite; no accounts, no external services required.

**Try it:** https://dev.standardbeagle.com/reader/demo/ — the full app running on bundled content, no install. Everything except adding sources works; read/snooze/list state stays in your browser.

Features beyond the basics:

- OPML import — point it at the export from your current reader and it subscribes to everything at once
- Ingestors: pull a Mastodon timeline, a Bluesky account or search, or a subreddit as a feed. A "combined AI view" merges several feeds into one stream, scored and summarized by an LLM through OpenRouter (your own key)
- Snooze an article until later today / tomorrow / next week; it stays unread and comes back on its own
- Saved lists, private or public — every public list is itself an RSS feed
- Unread-only navigation: a header toggle makes prev/next (buttons, touch swipe, j/k) jump between unread articles only
- Pinboard view for image-led feeds
- Article bodies sanitized server-side; binds 127.0.0.1 by default

**Stack:** Fastify + SQLite backend, React/Vite SPA, Electron shell, ~180 tests. Runs on a small VPS or a home box — I run it behind a Cloudflare tunnel on an old laptop.

**Links:**
- Demo: https://dev.standardbeagle.com/reader/demo/
- Source: https://github.com/standardbeagle/reader
- Docs (hosting guide included): https://dev.standardbeagle.com/reader/

Happy to answer questions. Known gaps: no folders yet, no full-text search, single-user for now (multi-user is on the roadmap).
