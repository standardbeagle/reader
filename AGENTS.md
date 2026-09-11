# reader — agent notes

## Commands

- Tests: `tman run -- pnpm -r test`
- Build: `tman run -- pnpm -r build`
- Dev: `READER_PORT=3737 pnpm dev:server` + `pnpm dev:web`
- Demo build: `VITE_DEMO=1 pnpm --filter @reader/web exec vite build --base=/reader/demo/ --outDir ../../site/public/demo --emptyOutDir` (CI does this in `.github/workflows/site.yml`)
- Demo seed: `node scripts/build-demo-seed.mjs` (regenerates `apps/web/src/demo/seed.json` from the local dev DB — subscribe feeds first)
- Screenshots: `node scripts/capture-screenshots.mjs [baseUrl]` (headless Chrome CDP, writes `site/src/assets/screenshots/`)

## Static demo

`dev.standardbeagle.com/reader/demo/` is the full web app built with `VITE_DEMO=1`.
`apps/web/src/api.ts` swaps the HTTP client for `apps/web/src/demo/demoApi.ts`
(top-level await on the env flag; `ApiError` lives in `apiShared.ts` because a
demoApi→api import would deadlock that await). Read/snooze/list state persists
in localStorage; anything needing a server answers `demo_readonly`. Hosted on
GitHub Pages with the docs site — $0, inside the $5–10/month budget.

## Exposure posture

| Listener | Exposure | Notes |
|----------|----------|-------|
| `127.0.0.1:3737` (reader.service on beagle-ab) | loopback | systemd user service; source of truth for the app. Unreachable from the LAN — cloudflared dials out, nothing dials in. |
| `reader.sbdev.io` (tunnel `reader` → 127.0.0.1:3737) | public | Protected by Cloudflare Access (email OTP policy). Tunnel runs as the `cloudflared-reader.service` systemd user unit on beagle-ab. |

Widening any listener beyond loopback is a user decision, never an agent's.

Access is the authorization control, not a convenience: reader has no authn of
its own while M4 is open (see **Known blockers**). Do not remove the Access
policy without closing that first.

### Verifying the public route

Cloudflare Access answers `302` at the edge for **any** request, whether or not
the tunnel reaches the origin — an unauthenticated `curl` returns the same code
for a healthy site and a dead one. `530`/`502` never surface. So a `302` proves
DNS and Access, and proves nothing about reader. Verify with all three of:

- `systemctl --user status cloudflared-reader` on beagle-ab, and
  `Registered tunnel connection` for several edge locations in its journal;
- the Cloudflare API reporting the tunnel `healthy` with >0 connections;
- `curl http://127.0.0.1:3737/api/v1/health` **on beagle-ab** for the origin.

End-to-end through Access needs an Access service token or an authenticated
browser.

## Deployment (beagle-ab)

- App: systemd user service `reader.service` (`~/.config/systemd/user/reader.service`), node at fnm v24.18.0 stable path, DB at `~/.local/share/reader/reader.db`, serves `apps/web/dist` via `READER_WEB_DIST`. Boot survival relies on `loginctl enable-linger`.
- Tunnel: `cloudflared-reader.service` reads `cloudflared-config.yml` from this repo. The per-tunnel credential lives at `/home/beagle/.config/cloudflared/reader.json` (`0600`, dir `0700`) — outside every working tree, never in the repo. `CLOUDFLARE_API_TOKEN` is workstation-only; provisioning runs from a workstation via `devkey`, never from beagle-ab. See the dev-fleet `beagle-ab-hosting` skill.
- Update flow: `git pull && pnpm install && pnpm -r build && systemctl --user restart reader`.
- Desktop dev requires better-sqlite3 ABI rebuild — see `apps/desktop/README.md`.
- Migrated from beagle-ab2 on 2026-08-11. That host keeps a pre-migration copy of `reader.db` as a backup and no longer runs reader; its `reader-beagle` tunnel now serves only `app-builder.sbdev.io`.

## Known blockers

- M4 (hosted multi-user): SSRF guard required before any unauthenticated exposure (spec section 9).

## Secrets (`~/.config/reader/env`, user-managed, chmod 600)

- `OPENROUTER_API_KEY` — LLM filter/summarize (currently needs a fresh key; the one previously in shell env is 401)
- Optional Bluesky auth: `BLUESKY_IDENTIFIER`, `BLUESKY_APP_PASSWORD` (or in the ingestor config).
- Mastodon/Reddit accounts and private-feed sign-ins live in the `credentials` table of `reader.db`, connected through the web UI's OAuth popup. They are plaintext at rest and never returned by the API. Access tokens, passwords and bearer tokens are sent through `auth/credentials.ts` `authorizationFor`, which refuses any URL off the credential's origin (callers: poller, Mastodon and Reddit adapters). Two exceptions: the account-name lookup right after sign-in (`auth/oauth.ts` `getJson`), which targets the credential's own origin; and `streamingTokenFor`, which hands a Mastodon token to the instance's streaming host when that host is the credential's host or a subdomain of it. OAuth refresh tokens and client secrets go only to the stored `tokenUrl`, which for a generic provider may be another host. `REDDIT_*` env vars are no longer read; migration 0009 deleted inline Reddit secrets from ingestor configs.
- Outbound WebSockets (`packages/server/src/realtime/`): Podping relay, Bluesky Jetstream, Mastodon streaming. They are outbound only, open only while a subscription needs them, and exposure is unchanged. Each connect passes the SSRF guard; frames over 256 KB are dropped. `GET /api/v1/realtime` shows socket state. `streamingTokenFor` lets a Mastodon token reach the instance's announced streaming host only when it is the credential's host or a subdomain of it.
- OAuth redirects land in the user's browser at `<origin>/api/v1/oauth/callback`, never server-to-server, so sign-in needs no exposure change. A Reddit web app's registered redirect URI must match the origin Reader is opened on (`https://reader.sbdev.io/api/v1/oauth/callback` in production).
