# reader — agent notes

## Commands

- Tests: `tman run -- pnpm -r test`
- Build: `tman run -- pnpm -r build`
- Dev: `READER_PORT=3737 pnpm dev:server` + `pnpm dev:web`

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
- Optional per-platform auth: `BLUESKY_IDENTIFIER`, `BLUESKY_APP_PASSWORD`, `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USERNAME`, `REDDIT_PASSWORD`
- Ingestor credentials may also live in ingestor config (local DB); API responses redact them.
