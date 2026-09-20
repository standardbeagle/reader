# Spike — How Libby holds hold surface in reader (article-centric vs panel)

- Task: `01M2XR54JG8VXPMBFGREGBWXV2`
- Date: 2026-09-19
- Companion: `docs/spikes/libby-holds-access.md` (same queue) decided **what data we can get**: Path 1 (private sync) has personal position/wait/expiry but a 7-day refresh-less token and ToS risk; Path 2 (public thunder) has `holdsCount`/`availableCopies`/`isAvailable` but never "you're #12"; the recommendation there is hybrid, with the adapter carrying a **state-diff cursor** per hold (access spike :135). This doc decides **what the user sees**.
- Status: complete against the code; two data-semantics unknowns are operator-gated (inherited from the access spike).

## Question

Reader's model is feeds of articles with read/snooze/list state; ingestors deliver `NormalizedItem`s that become articles keyed by `externalId`. A Libby hold is not an article — it is an entity whose state changes over days. How does it surface?

- **(a)** a Libby feed emitting **one item per hold state transition** (placed, moved, available, expired, cancelled) — read/snooze/lists then work for free;
- **(b)** a **dedicated holds panel** showing current position + estimated wait for every hold;
- **(c)** **both**: feed item carries current status, feed header summarizes holds.

## What was checked, and how (all in this checkout)

| Fact | Evidence |
|---|---|
| `NormalizedItem = { externalId, author, title, text, url, publishedAt }` — no position/wait fields | `packages/server/src/storage/types.ts:136-143` |
| Ingestor article guid is synthesized: `ing:${ingestorId}:${externalId}` | `packages/server/src/ingestors/engine.ts:138` |
| Staging dedupes per ingestor on `external_id` (`ON CONFLICT DO NOTHING`), delivery filters `delivered_at IS NULL`, `markDelivered` seals each id | `packages/server/src/storage/sqlite.ts:605-641` |
| Consequence: once an externalId is delivered it can never be re-staged or re-delivered — the `updateExisting` branch in `upsertArticles` (`sqlite.ts:262-274`, run at `:317-326`) is unreachable for ingestor articles. **Ingestor articles are immutable; a new state must be a new article.** | `sqlite.ts:316-326` + `engine.ts:148` |
| With the LLM off, `title = item.title ?? text.slice(0,80)`, `summary = item.text` verbatim; with LLM on, `summarizeBatch` **rewrites** title/summary | `packages/server/src/llm/pipeline.ts:14-23,43-55` |
| `llmEnabled` defaults to on at creation (400 unless key present) — a holds ingestor must explicitly pass `llmEnabled:false` or the LLM will paraphrase the status text | `packages/server/src/api/routes-ingestors.ts:112-115` |
| Rendered body = `<p>{escaped text}</p>` + a "View original" link when `url` is set | `engine.ts:143` |
| Newlines inside that generated `<p>` collapse (`white-space: pre-wrap` only applies to the `.feed-plain-text` lane, which the ingestor path never uses) → **status text must be one line, `·`-separated** | `apps/web/src/styles.css:534-535`, `ArticleView.tsx:550-572`, `engine.ts:143` |
| `digestMode:"realtime"` preserves `item.publishedAt`; hourly/daily re-stamp to delivery time | `engine.ts:142` |
| List row shows title + date; rows grouped into Today/Yesterday/day sections by `publishedAt` | `apps/web/src/ArticleList.tsx:27-45,119-129` |
| Opening an article marks it read | `ArticleList.tsx:131-134` |
| Title in the reader view is a link to `url` (new tab); an "Embedded page" tab appears only if the server deems the url frameable, else it is aria-disabled with a reason | `ArticleView.tsx:229-231,296-304,329-342` |
| `safeUrl` allows only http/https | `apps/web/src/urls.ts:1-7` |
| Snooze: `setSnooze(userId, articleId, Date|null)` — arbitrary instant; future `snoozedUntil` hides the article from the default list and unread counts until it passes; `?snoozed=1` includes it | `storage/types.ts:76-78,191-192`, `sqlite.ts:339-341` (list filter), `api/routes.ts:229-230` |
| Snooze **UI** offers only three fixed presets (3 h / tomorrow 9:00 / next week 9:00) — no custom or computed-date control | `ArticleView.tsx:369-380,404-431` |
| Saved lists, chips, "all lists" dialog are per-article and content-agnostic | `ArticleView.tsx:444-515` |
| Sidebar has exactly two sections — Feeds and Lists; feed rows carry unread count, platform badge, mark-all (✓), unsubscribe | `Sidebar.tsx:94-149` |
| Platform badge (and hiding the manual-refresh button, which returns 409 for ingestor feeds) keys off a regex on the feed url: `^ingestor://(mastodon\|bluesky\|reddit\|composite)/` | `apps/web/src/api.ts:72-75`, `Sidebar.tsx:106,112`, `api/routes.ts:34-36` |
| Ingestor feeds are titled from `adapter.validate()` and created as `ingestor://kind/...` | `routes-ingestors.ts:62-77,125-138` |
| The browser learns of new articles by 60 s polling, not push (server's `realtime/` sockets are outbound relays only) | `App.tsx:58,76` |
| Feed title can be updated by the server without a new column: `updateFeedFetchState` sets `title = COALESCE(?, title)` | `sqlite.ts:232-253` (line 242), `storage/types.ts:130` |
| Adding a source kind = a wizard entry + form (web) + adapter + `IngestorKind` (server) | `SourceWizard.tsx:8,78-86`, `ingestors/index.ts:9-14`, `storage/types.ts:145` |
| Demo: seed shape `{feeds, articles, lists, listItems, embeddability, podcastExtras}`; read/snooze/list state is a localStorage overlay; `isVisible` hides actively-snoozed articles; unknown embeddability defaults to `{embeddable:null}`; `listIngestors` returns `[]` and all mutating source ops answer `demo_readonly` | `apps/web/src/demo/demoApi.ts:24-34,76-79,123-124,152-175,205-216` |
| `build-demo-seed.mjs` copies only a hardcoded allowlist of six public RSS feeds from the dev DB and overwrites `seed.json` | `scripts/build-demo-seed.mjs:22-27,56-57,159` |
| articles table columns (no metadata slot beyond text fields): guid/url/title/author/published_at/content_html/summary/image_url/categories/media... | `storage/migrations/0001_init.sql`, `0004`, `0005`, `0006`, `0011` |

## What the existing plumbing does to a holds item

An item delivered with `llmEnabled:false`, `digestMode:"realtime"` arrives as: a one-line-title row under Today (`ArticleList.tsx:119-129,27-45`), a reader view showing the status text plus "View original" (`engine.ts:143`), auto-marked-read when opened (`ArticleList.tsx:131-134`), snoozable to any instant at the storage layer (`storage/types.ts:192`), savable to any list (`ArticleView.tsx:444-515`), counted in feed/sidebar unread (`Sidebar.tsx:98,109`) and clearable via the row's ✓ (`Sidebar.tsx:118` → `markAllRead`, `storage/types.ts:193`). Every reader feature operates on exactly these fields and nothing else — the transition-item shape is a first-class citizen with **zero UI change**.

What is *not* free: the item is a **log entry, not a live cell**. The current state of a hold is only visible by finding its newest row. And "snooze until the estimated ready date" maps onto existing storage but not onto the existing **menu** (three fixed presets, `ArticleView.tsx:371-380`).

## Options

### (a) Transition feed only

- **Hold moves:** a new unread row today: `Moving up · <Title> · #8, was #12` in the All and Libby lists; sidebar badge +1; the old row stays read. Within 60 s (`App.tsx:76`).
- **Hold becomes available:** a new unread row `Ready now · <Title> · borrow by <date>`; opening it marks the notice read; the title link / "View original" goes to the Libby title page (`ArticleView.tsx:229-231`) — reader never opens the book; the Embedded tab self-disables if libbyapp.com refuses framing (server embeddability check, `ArticleView.tsx:296-304`).
- **Nothing changes:** nothing appears. The diff cursor (access spike :135) emits only on observed transition; a poll that sees the same state produces no item. This is the option's load-bearing property: **silence is the design.**
- **Existing features unchanged:** read, mark-all-read, snooze (as "shut this notice up" — the *next* real event is its own new item regardless), saved lists, unread counts, day grouping, board view, public-list RSS export. No web diff needed.
- **New UI/schema:** none in reader. Server side: a `libby` adapter (the expensive part, scoped in the access spike), `IngestorKind += "libby"`, credential provider (access spike's model). Optional one-liner: extend `feedPlatform` (`api.ts:72`) so the sidebar gets a `libby` badge and hides the ↻ button (without it, ↻ shows and answers 409 — visible wart, `Sidebar.tsx:112`, `routes.ts:34-36`).
- **Costs:** (1) log growth — an active 20-title queue can emit many `moved` rows per week; needs an emission throttle (below). (2) "what's my whole queue now?" has no answer; the user scans rows. (3) exact-date snooze absent (presets only).

### (b) Dedicated holds panel only

- **Hold moves:** the panel row's position updates **in place**; no unread event, nothing in feeds. The user only sees it by opening the panel.
- **Available:** row flips to a "ready" style. Still no push into the reader's attention system (unread counts, day list).
- **Nothing changes:** identical panel.
- **Existing features unchanged:** none — read/snooze/lists are per-article state; panel rows are not articles.
- **New UI/schema:** a third sidebar section or a special feed view (`Sidebar.tsx` has no slot for it); a component with its own refresh/empty/error states; a place to read the snapshot from — cheapest is the state-diff cursor already stored per ingestor (`storage/types.ts:162`, serialized by `routes-ingestors.ts:100-106`), so possibly no new route. Panel must be reachable on mobile widths alongside the three-column layout.
- **Costs:** the most UI work, and it re-creates in a corner what reader's core loop already does (surface something changed, let the user acknowledge) while being isolated from it: a hold becoming available in the panel is invisible to someone who lives in the feed.

### (c) Both, feed carries status + header summarizes

- The (a) semantics **plus** the (b) panel. A hold move: row in feed, updated panel row. Available: unread row + highlighted panel row. Nothing: silence in both.
- A literal "feed header" component does not exist — the list panel head is a static `Articles` title (`ArticleList.tsx:198-210`). **Cheap honest substitute, (c)-lite:** the adapter re-titles its own feed each sync to `Libby · 12 holds · 1 ready` via the existing `title = COALESCE` path (`sqlite.ts:242`); the sidebar row *is* the header, unread badge unchanged. Cost: ~10 lines in the ingestor engine to call `updateFeedFetchState` (today the engine only touches ingestor state, `engine.ts:87-89`), and a sidebar title that churns on every poll.
- **Costs:** the union of (a) and (b) — unless only (c)-lite is built, which is roughly (a)+10 server lines and defers the panel.

### Cross-cutting emissions policy (applies to a and c)

Path-1 positions for popular titles advance slowly with big jumps; emitting every `#34→#33` is spam. Adapter rule: emit `moved` only when the new position ≤ 10 **or** the jump is ≥ 5 places / ≥ 25 %. Terminal events (`placed`/`ready`/`expired`/`cancelled`) always emit. (Thresholds are a planning dial, not a discovery.)

## Exact item shapes (Path 1 data; LLM off)

`title` is set explicitly on every item, so the 80-char fallback (`pipeline.ts:18`) never engages. Text is one line; engine appends the "View original" link from `url` (`engine.ts:143`), so the body never repeats a link. Example book: *The Left Hand of Darkness*, audiobook, Cleveland Public Library (`clevnet`).

| Kind | `externalId` | `title` | `text` (becomes the reader body, verbatim) | `url` | `publishedAt` |
|---|---|---|---|---|---|
| placed | `hold:<holdId>:<seq>:placed` | `Hold placed · The Left Hand of Darkness · #12 in queue` | `Audiobook · Cleveland Public Library · you are #12 in the queue · 34 active holds · 3 copies · estimated available Nov 3 (~14 days)` | title page | transition time |
| moved | `hold:<holdId>:<seq>:moved` | `Moving up · The Left Hand of Darkness · #8, was #12` | `You moved from #12 to #8 · estimated available Oct 27 (~8 days) · Audiobook · Cleveland Public Library` | title page | transition time |
| available | `hold:<holdId>:<seq>:ready` | `Ready now · The Left Hand of Darkness · borrow by Nov 6` | `Available now · your reservation is held until Nov 6 · Audiobook · Cleveland Public Library · open in Libby to start the loan` | title page | transition time |
| expired | `hold:<holdId>:<seq>:expired` | `Hold expired · The Left Hand of Darkness` | `Your reservation lapsed Nov 6 before you borrowed it · last position #1 · open in Libby to place a new hold` | title page | transition time |
| cancelled | `hold:<holdId>:<seq>:cancelled` | `Hold cancelled · The Left Hand of Darkness` | `Hold cancelled from Libby on Nov 2 · no further updates for this hold` | title page | transition time |

### externalId scheme and the once-per-transition guarantee

`hold:<holdId>:<seq>:<kind>` where `holdId` is the `hold.id` from `/chip/sync` (the only field the access spike confirmed exists, :63) and `seq` is a **per-hold change counter kept in the adapter's state-diff cursor**, incremented once per detected transition.

Why the counter and not the value: an id like `hold:<id>:pos:<p>` relies on position never repeating; position is monotone while the queue drains, but editions/formats can merge and re-split (unknown — see Open questions), and a date suffix (`:ready:2026-11-03`) silently loses a second same-day transition because `stageItems` will not re-stage a delivered externalId (`sqlite.ts:612`) — the change would vanish, not duplicate. `{holdId, seq}` makes every detected transition unique by construction; the kind suffix stays for grep-ability in the guid. The *article* is likewise unique: `ing:<ingestor>:<externalId>` cannot collide with any earlier row, and the conflict path never fires.

Path-2-only fallback (operator declined Path 1): personal position/wait/expiry rows **cannot be produced** (access spike :104-112). What survives: `available`-ish rows keyed `media:<titleId>:<format>:<seq>` with text `N copies are free at Cleveland Public Library now · <holdsCount> active holds` — explicitly *library* availability, not *your turn*. The `#N in queue` segment simply doesn't exist in that world.

## Does `NormalizedItem` need a new field?

**No. Keep it as is; the status rides in `text`** (`storage/types.ts:136-143`).

- The whole read/snooze/list surface renders exactly these fields; a structured `position`/`wait` would need: new `articles` columns (migration 0013), the `ParsedArticle` mapping in `engine.ts:137-145` widened, API/web `Article` types widened, and new row/detail rendering in `ArticleList.tsx:119-129` / `ArticleView.tsx` — **four layers of plumbing to draw the same sentence a bit bolder**. The staging layer itself round-trips `NormalizedItem` as JSON (`sqlite.ts:615`), so a new field would be free at staging and expensive everywhere it is *seen*.
- The only consumer that genuinely wants structured current-state is option (b)'s panel — and its correct source is the **ingestor cursor snapshot** (already persisted, `storage/types.ts:162`, already serialized by `routes-ingestors.ts:100-106`), not the article log. Deriving live state by "latest article per hold" would parse position out of prose — the worst of both.
- Consequence stated honestly: with text-only status, **SQL cannot answer "what is hold X's current position"**; per-hold live state exists in exactly one place, the adapter cursor. That is acceptable for (a)/(c)-lite and is the data source (b) would reuse.

## What the static demo shows

Demo (`VITE_DEMO=1`, `demoApi.ts`) is a static seed + localStorage overlay, so it can show **(a) completely**:

- one seed feed `{ title:"Libby holds", url:"ingestor://libby/queue" }` plus ~5 articles: `placed`, `moved`, `ready` for one title and `placed` (future estimate) for a second — with the exact strings above;
- the `ready` item linked into the existing demo "Want to read" list (`listItems`), proving lists;
- the visitor's own taps do the rest: opening marks read (`demoApi.ts:152-158`), snoozing the `placed` item hides it and drops the unread count (`isVisible`/`unreadCount`, `demoApi.ts:76-79,99-101`), reproducing the whole feature loop offline;
- give the libby url an explicit `embeddability:false` stub so the Embedded tab shows its honest disabled state instead of a blank iframe (default `{embeddable:null}` enables the tab, `demoApi.ts:123-124`).
- The demo cannot show (b): `listIngestors` returns `[]` and source management is `demo_readonly` (`demoApi.ts:205-216`); no badge appears next to the feed until `feedPlatform` learns "libby" (`api.ts:72`).

Needs seed data: yes — and `build-demo-seed.mjs` will not produce it: it selects only its hardcoded public-feed allowlist (`:22-27,56-57`) and **overwrites** `seed.json` (`:159`). Plan the holds entries as a static snippet injected by the script at build time, or regeneration silently deletes the demo.

## Recommendation

**(a), with the (c)-lite feed-title summary deferred one step.** The transition-feed is the option where every existing reader feature — read, snooze, lists, unread counts, mark-all, day grouping, mobile board, RSS export — applies *unchanged* and costs zero UI. The panel (b/c) buys one thing ("current queue at a glance") at the price of the entire new-surface cost plus the risk of a status surface the user never opens — and its data source (the adapter cursor) isn't in articles, so it does not even share plumbing with the feed. Reconsider the panel only if real use shows the log's scan-to-find-current-state hurting; then build it off the cursor, not off articles. Consequence inherited: the whole feature rides on the access spike's Path-1 acceptance (position/wait/ready dates), else (a) degrades to library-availability notices only.

## Open questions for planning

1. **Real `holds[]` field set** — `holdListPosition`, `estimatedWaitDays`, `expireDate` names and whether `holdId` survives format-switch or re-placing a lapsed hold (breaks/keeps the `seq` scheme's entity assumption). Gated on the operator's `probe.mjs` capture (access spike :166-170).
2. **ToS acceptance for Path 1** — same gate; decline ⇒ only the degraded library-availability text ships.
3. **Moved-noise dial** — position ≤ 10 or ≥ 5-jump threshold is a guess; digest mode (hourly rollup) may be the better default for a slow queue.
4. **Snooze-until-estimated-date** — needs the date client-side; either a fourth conditional preset fed by a structured field (violates the text-only decision above — keep it out) or accept the trio's "Next week" approximation. Plan a call.
5. **Retention** — transition rows accumulate forever; reader has no per-feed pruning today. A "hold history is disposable" cleanup story (or an auto-`moved`-prune in the adapter) belongs in planning.
6. **Wizard/credential UX for Libby** — Path-1 re-clone is a manual weekly-ish ritual (access spike :58); the UI must tell the user *in the feed* when the credential dies (adapter error → feed `lastError` badge exists, `Sidebar.tsx:105`).
