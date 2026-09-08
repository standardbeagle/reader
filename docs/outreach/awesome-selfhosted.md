# Outreach copy — awesome-selfhosted (submit 2026-12-08 or later)

Channel: PR to awesome-selfhosted/awesome-selfhosted-data adding `software/standardbeagle-reader.yml`.
Hard gate: the first tagged release (v0.2.0, 2026-08-08) must be 4 months old, so the project is eligible 2026-12-08.
Rules: description < 250 chars, sentence case, no "open-source"/"free"/"self-hosted" words (the list implies them). Note the existing `reader` entry (lemon24/reader): a name collision, flagged in the PR body for maintainers.

## software/standardbeagle-reader.yml

```yaml
name: reader
website_url: https://dev.standardbeagle.com/reader/
source_code_url: https://github.com/standardbeagle/reader
description: "Google Reader clone with OPML import, snooze, saved lists that are themselves RSS feeds, and Mastodon/Bluesky/Reddit ingestors with optional LLM filtering; web service or desktop app (alternative to Google Reader, Feedly)."
demo_url: https://dev.standardbeagle.com/reader/demo/
licenses:
  - MIT
platforms:
  - Nodejs
tags:
  - Feed Readers
```

## PR title

Add reader

## PR body

<!-- DO NOT DELETE THE TEXT BELOW . Please make sure relevant boxes are checked [x] -->

- [x] Submit one item per issue.
- [x] I have searched the repository for relevant issues or PRs, including closed ones.
- [x] The software is not listed at awesome-sysadmin, staticgen.com, staticsitegenerators.bevry.me, dbdb.io.
- [x] The project is actively maintained.
- [x] The project's first release (v0.2.0, 2026-08-08) is more than 4 months old.
- [x] The project has working installation instructions (docs site + README quickstart).

reader is a Google Reader clone: a Node.js web service with an embedded SQLite database, also packaged as an Electron desktop app from the same codebase. It has a classic three-pane UI with a mobile layout and PWA support, OPML import, snooze, saved lists (public lists are RSS feeds), unread-only navigation, and ingestors that turn Mastodon / Bluesky / Reddit timelines into feeds, with optional LLM filtering via a user-supplied OpenRouter key. MIT license.

Interactive demo (static bundle, no signup): https://dev.standardbeagle.com/reader/demo/
Install instructions: https://dev.standardbeagle.com/reader/getting-started/

Note for maintainers: the Feed Readers section already lists [lemon24/reader](https://github.com/lemon24/reader) as "reader". This is a different project (standardbeagle/reader). I kept the project's name in the YAML and used a distinct filename; happy to rename the display entry if you prefer to disambiguate.
