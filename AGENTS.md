# reader — agent notes

## Commands

- Tests: `tman run -- pnpm -r test`
- Build: `tman run -- pnpm -r build`
- Dev: `READER_PORT=3737 pnpm dev:server` + `pnpm dev:web`

## Exposure posture

| Listener | Exposure | Notes |
|----------|----------|-------|
| `127.0.0.1:3737` (reader.service) | loopback | systemd user service; source of truth for the app |
| `reader.sbdev.io` (cloudflared tunnel → 127.0.0.1:3737) | public | Protected by Cloudflare Access (email OTP policy). Tunnel runs as `cloudflared.service` systemd user unit. |

Widening any listener beyond loopback is a user decision, never an agent's.

## Deployment (beagle-ab2)

- App: systemd user service `reader.service` (`~/.config/systemd/user/reader.service`), node at fnm v24.18.0 stable path, DB at `~/.local/share/reader/reader.db`, serves `apps/web/dist` via `READER_WEB_DIST`.
- Update flow: `git pull && pnpm install && pnpm -r build && systemctl --user restart reader`.
- Desktop dev requires better-sqlite3 ABI rebuild — see `apps/desktop/README.md`.

## Known blockers

- M4 (hosted multi-user): SSRF guard required before any unauthenticated exposure (spec section 9).
