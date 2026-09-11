---
title: Hosting
description: How the hosted reader deployment runs — systemd, loopback binding, Cloudflare tunnel, and the update flow.
---

The production deployment runs on a small always-on Linux host (beagle-ab) as
a set of systemd **user** units. Nothing dials in: the app binds loopback and
a Cloudflare tunnel dials out.

## Topology

| Listener | Exposure | Notes |
| --- | --- | --- |
| `127.0.0.1:3737` (`reader.service`) | loopback | The app; source of truth. Unreachable from the LAN. |
| `reader.sbdev.io` (tunnel → `127.0.0.1:3737`) | public | Protected by Cloudflare Access (email OTP). |

Widening any listener beyond loopback is a deliberate decision — reader has
no authentication of its own while hosted multi-user (M4) is open, so the
Cloudflare Access policy **is** the authorization control.

## Units

- `reader.service` — node (fnm-managed v24) running the server with
  `READER_WEB_DIST` pointing at `apps/web/dist`, so one process serves the
  API and the SPA. The database lives at `~/.local/share/reader/reader.db`.
  Boot survival relies on `loginctl enable-linger`.
- `cloudflared-reader.service` — the tunnel. Its config
  (`cloudflared-config.yml`) is versioned in the repo; the per-tunnel
  credential file lives outside every working tree at
  `~/.config/cloudflared/reader.json` with `0600` permissions and is never
  committed.

## Verifying the public route

Cloudflare Access answers `302` at the edge for **any** request, tunnel
healthy or not — a `302` proves DNS and Access, and nothing about the app.
Check the pieces on the host instead:

```bash
systemctl --user is-active reader cloudflared-reader   # both "active"
curl -s http://127.0.0.1:3737/api/v1/health            # {"ok":true}
# cloudflared's metrics listener reports live edge connections:
ss -ltnp | grep cloudflared                            # find its 127.0.0.1 port
curl -s http://127.0.0.1:<port>/ready                  # {"status":200,"readyConnections":4,…}
curl -s http://127.0.0.1:3737/api/v1/realtime          # outbound stream state
```

The user journal can be empty for a long-running tunnel, so its
"Registered tunnel connection" lines are not a reliable check.

End-to-end through Access additionally needs a service token or an
authenticated browser.

## Updating

Deploys come from `main` only. Back up the database first when the update
carries migrations; they run on the next start and some rewrite data.

```bash
cd ~/work/experimental/reader
systemctl --user stop reader
sqlite3 ~/.local/share/reader/reader.db ".backup $HOME/.local/share/reader/reader.db.pre-deploy-$(date +%Y%m%d-%H%M%S)"
git pull --ff-only
pnpm install --frozen-lockfile
pnpm -r build
systemctl --user start reader
```

## Outbound connections

The app makes only outbound connections: feed fetches, OAuth token
exchanges, and, while subscriptions need them, WebSockets to a Podping relay,
Bluesky Jetstream and Mastodon streaming servers. OAuth sign-in redirects go
through the user's browser, so none of this changes the table above. Each
stream can be switched off; see [Configuration](/reader/configuration/).

The docs site (`site/`) is excluded from the pnpm workspace; GitHub Actions
builds and deploys it to Pages on push.
