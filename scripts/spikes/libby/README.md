# scripts/spikes/libby — throwaway hold-access probes

Reverse-engineering probes for spike `01M2XR54HGC05VT029CH9KD6Q5`. **Throwaway.**
Never imported by `packages/server`. Endpoints from
`ping/libby-calibre-plugin` `calibre-plugin/libby/client.py`.

## Secrets — environment variables only

Nothing here reads a file for a secret. Codes are single-use and rotate (~60s),
so supply one at run time; nothing is written to disk and nothing is printed.

| var | used by | what |
|-----|---------|------|
| `LIBBY_SETUP_CODE` | `probe.mjs` | 8-digit code from Libby → Copy To Another Device → the legacy **Sonos / Android Auto** sub-option (the only flow that still generates a *phone-side* code the clone endpoint accepts). |
| `LIBRARY_KEY` | `availability.mjs` | Public OverDrive library key (string `preferredKey`, e.g. `clevnet`). Not a secret. |
| `TITLE_ID` | `availability.mjs` | Public OverDrive media id. Not a secret. |

## Commands

```sh
# Path 1, mint only — no user secret, safe. Reports token lifetime (~7 days).
node scripts/spikes/libby/chip-info.mjs

# Path 2, public availability for any real title — no credentials.
#   Discover a live media id for a library with the keyless search, then:
LIBRARY_KEY=clevnet TITLE_ID=$(curl -sS \
  'https://thunder.api.overdrive.com/v2/libraries/clevnet/media?title=project+hail+mary&limit=1' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).items[0].id))') \
  node scripts/spikes/libby/availability.mjs

# Path 1 full chain: clone + sync + held-title availability. REDACTED stdout only.
#   Paste the output into docs/spikes/libby-holds-access.md (Pending section).
LIBBY_SETUP_CODE=... node scripts/spikes/libby/probe.mjs
```

## Safety notes

- `lib.mjs redact()` masks `identity`, `token`, `authorization`, `barcode`,
  `username`, `pin`, `email`, `code`, any ≥18-char id, and any bare JWT before
  anything is printed. Numbers (position/wait/copies) are kept — they are the
  point of the spike.
- `sentry-read.svc.overdrive.com`'s TLS cert is `*.odrsre.overdrive.com` and does
  **not** match that hostname, so `chip()` sets `rejectUnauthorized:false` on
  that host **only**. `thunder.api.overdrive.com` is verified normally.
- A bad/expired code returns `404 {"result":"not_found"}` (not 401/400) — by design,
  so probing with an obviously-invalid code (eight zeros) is safe.
