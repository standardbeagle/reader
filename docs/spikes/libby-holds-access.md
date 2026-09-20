# Spike — Libby hold data access (sync API vs public availability)

- Task: `01M2XR54HGC05VT029CH9KD6Q5`
- Date: 2026-09-19
- Status: **non-secret paths fully verified live; two items pending the operator's Libby setup code (question door)**
- Author apparatus: throwaway probes under `scripts/spikes/libby/` (`lib.mjs`, `chip-info.mjs`, `availability.mjs`, `probe.mjs`). Never imported by `packages/server`. All secrets read from environment variables only; all captured output is redacted by `lib.mjs redact()` (masks `identity`, `barcode`, `username`, `pin`, `email`, `code`, `token`, any ≥18-char id, any bare JWT).

## Question this answers

Reader wants to surface a patron's Libby **hold queue** — for each held title: position in the queue, estimated wait, whether it is now available (ready for loan), and the owning card. Two candidate data paths plus any third option were probed against the real OverDrive/Libby services to decide which one reader builds on.

## How it was checked

- Endpoints first read from the community reverse-engineering in `ping/libby-calibre-plugin` `calibre-plugin/libby/client.py` (`get_chip`, `clone_by_code`, `sync`), which itself credits `lullius/pylibby`. The spike then re-derived each step against the live service.
- `chip-info.mjs` / `probe.mjs` mint + (attempt) clone against `sentry-read.svc.overdrive.com`; `availability.mjs` hits the public `thunder.api.overdrive.com`.
- TLS/SAN inspected directly: `openssl s_client` against both hosts (evidence below).
- Nothing in this doc or the scripts contains a setup code, token, card number, or barcode. Reproducible commands are given so the operator runs them with their own code.

---

## Path 1 — Libby sync API (`https://sentry-read.svc.overdrive.com`)

### Verified request sequence (observed live, 2026-09-19)

1. **Mint an anonymous device chip** — no credential required.
   - `POST https://sentry-read.svc.overdrive.com/chip?client=dewey`
   - Header **names** sent: `user-agent`, `accept: application/json`, `referer: https://libbyapp.com/`, `cache-control`, `pragma`, `accept-encoding`. (No `authorization` on this call.)
   - Response: `200 application/json`, top-level keys `chip`, `identity`, `syncable`, `primary`.
   - `identity` is a **JWT bearer token** (3 base64url segments); `syncable:false`, `primary:true` for a brand-new chip.
   - Observed mint response header names: `server`(nginx), `date`, `content-type`, `transfer-encoding`, `connection`, `vary`, `status`, `content-language`, `etag`, `cache-control`, `x-request-id`, `x-runtime`. No `retry-after`.

   Redacted mint capture (`libby-calibre`'s `get_chip`):
   ```json
   { "chip": "32dc…35(36)", "identity": "<redacted>", "syncable": false, "primary": true }
   ```

2. **Clone the chip from the setup code** — links the operator's account into that token.
   - `POST https://sentry-read.svc.overdrive.com/chip/clone/code`
   - Header **names**: same as above **plus `authorization: Bearer <identity>`** and `content-type: application/x-www-form-urlencoded`.
   - Body shape: form-urlencoded `code=<8-digit setup code>`.
   - **Observed rejection shape** for an invalid/rotated code (`LIBBY_SETUP_CODE` set to eight zeros — a code Libby never issues):
     ```
     HTTP 404   { "result": "not_found" }
     ```
     A 404 `not_found` (not 400/401) is how the service answers a code that is wrong, already-used, or expired — setup codes are single-use and rotate roughly every 60s (per Libby help + community reports). **Success shape is pending the operator's live code** (`probe.mjs` prints its redacted keys; see Pending).
   - `clone` may return a **new** `identity` (re-mint so the JWT carries the linked card). `probe.mjs` detects and prefers `clone.json.identity` when present. The pre-clone JWT's `chip` claim shows `cards:null`; the linked card is embedded in the token only after a successful clone.

3. **Sync the whole account state**
   - `GET https://sentry-read.svc.overdrive.com/chip/sync`
   - Header names: same defaults **plus `authorization: Bearer <identity>`**; no body.
   - Response: `{ result: "synchronized", cards: [...], loans: [...], holds: [...], ... }`.
   - **One `/chip/sync` returns all cards** the account has — `is_logged_in()` in the calibre client keys off `result === "synchronized" && cards.length`. The holds array is the patron's full cross-card queue, so a single poll refreshes everything; no per-card pagination is required for state detection. (Exact field set inside `holds[]` is pending the operator's live capture — see below.)

### Observed token model (Path 1)

- The JWT is the only credential. Claims observed on a freshly-minted chip: `{ aud: "readiverse", iss: "sentry", chip: {id, pri, ag, cards, prbn}, exp }`.
- **Lifetime — observed: exactly 7 days (168.0 h) from mint.** `exp` was measured at `mint + 168h` on repeated mints; no `iat` claim, so lifetime is inferred from `exp` against wall-clock at mint. This matches the community report "the token expires after about a week."
- **There is no refresh token and no refresh endpoint.** Renewal = mint a new chip and clone again (needs a fresh setup code). A polling server will therefore hit a **hard 7-day wall** and cannot renew headlessly.
- **Does cloning to reader log the phone out?** Not directly observable without a live code. Community evidence (Libby's feature is *explicitly* multi-device "keep your devices in sync") indicates adding a device does **not** evict the original. Flagged for the operator to confirm on their own card after `probe.mjs`.

### Holds response — field hypotheses vs what the spike can confirm

Task hypotheses for `holds[]`: `title, id, library/card, holdListPosition, ownedCopies, holdsCount, estimatedWaitDays, isAvailable, placedDate, expireDate`. The calibre client's own accessors confirm at least `hold.id` (media/title id), `hold.cardId` (card binding), and that holds carry per-format `copies` — but the full redacted capture of a real `holds[0]` requires the operator's account. **Pending** (`probe.mjs` prints it redacted). This is the one field-level claim the doc cannot yet assert without the user's code.

### Polling cadence

- OverDrive/Libby exposes **no server-driven cadence** on these endpoints: no `retry-after`, no polling hint observed in the mint/sync headers. The official client syncs on app foreground and on push; there is no machine-readable interval to copy.
- A reader ingestor must pick its own cadence. Queue position/wait change slowly (they are driven by other patrons borrowing/returning), so an aggressive poll buys nothing and raises ToS/abuse risk. Recommendation: **≥ 30 min**, and back off on `429`/`4xx`.

### ToS and fragility risk of Path 1 — in plain words

- **ToS:** `sentry-read.svc.overdrive.com` is Libby's **private, undocumented** sync backend. OverDrive's public terms forbid scraping or automated access to services not offered as a public API, and this is not one. Using it is a breach of the consumer ToS and an acceptance that OverDrive can revoke access, change the protocol, or ban the chip at any time with no notice and no support. This is a *personal-convenience* integration, not a sanctioned one. **The operator must explicitly accept this** (recorded in Pending — the recommendation is contingent on that answer).
- **Fragility — all observed on 2026-09-19:**
  1. **TLS hostname mismatch.** `sentry-read.svc.overdrive.com` presents `CN=*.odrsre.overdrive.com` (SAN list is `*.odrsre.overdrive.com`, `*.read.*.odrsre.overdrive.com`, …) — the requested hostname matches **none** of them. `curl` fails with `SSL: no alternative certificate subject name matches target host name 'sentry-read.svc.overdrive.com'`. Every working client (calibre plugin, booklife-mcp) disables hostname verification. Consequence for reader: `fetchCapped`/undici will **refuse this host** by default; Path 1 is not drop-in for the existing fetch stack.
  2. **Setup-code direction flipped (~Sept 2024).** Libby now generates the recover code on the *new* device; the old "phone shows the code" flow survives only under the legacy "Sonos / Android Auto" sub-option, which community forks still use to clone. If Libby removes that, cloning breaks entirely.
  3. **7-day token with no refresh** (above) — a server cannot self-renew.
  4. **Shape drift / no contract.** Field names can change silently; the `client_upgrade_required` failure mode exists when the baked-in client version goes stale.
  5. **No rate-limit signal** — abuse is punished by token/ban, not by a backoff header, so failures are sudden.

---

## Path 2 — Public availability (`https://thunder.api.overdrive.com/v2/libraries/{libraryKey}/media/{titleId}`)

### Request — no credentials

- `GET https://thunder.api.overdrive.com/v2/libraries/clevnet/media/<public-media-id>` (a real, public catalog title; id masked — it is a public OverDrive media id, not a setup code)
- Sent with `accept: application/json` only. **No `authorization` header needed.** An unknown id returns `404` (not `401/403`) → confirms it is genuinely anonymous, not merely key-optional.
- **TLS is clean** here: cert `CN=*.api.overdrive.com` (SAN `*.api.overdrive.com`, `*.hq.overdrive.com`, `*.overdrive.com`) matches the host. Drop-in for reader's `fetchCapped`.
- `libraryKey` = the library's string `preferredKey` (e.g. `clevnet`), **not** the numeric `accessId` (numeric gave `LibraryNotFound`). Obtainable from the public `GET /v2/libraries?location=<zip>` list, which is also credential-free.

### Captured availability response (redacted), for `isAvailable:false`, 0/1 copies

Top-level keys (abridged): `reserveId, title, id, type, formats, creators, …, isAvailable, availableCopies, ownedCopies, luckyDayAvailableCopies, luckyDayOwnedCopies, holdsCount, isFastlane, availabilityType, isHoldable, isOwned, isRestricted, visitorEligible, covers, publisherAccount`.

Values for the probed audiobook:
```json
{
  "isAvailable": false,
  "availableCopies": 0,
  "ownedCopies": 1,
  "holdsCount": 1060,
  "availabilityType": "normal",
  "isHoldable": true,
  "estimatedWaitDays": "(ABSENT — not returned)",
  "holdListPosition": "(ABSENT — not returned)"
}
```

### What Path 2 can and cannot give

- **Can:** whether the title has copies ready for *anyone* right now (`isAvailable`, `availableCopies`), how many copies the library owns (`ownedCopies`), the **total number of active holds on the title** (`holdsCount`), and holdability/availability-type/format detail. Per-format `copies` too.
- **Cannot:** the requesting patron's **own queue position** (`holdListPosition`), a **personalized `estimatedWaitDays`**, the patron's own `expireDate`/loan window, or which card holds it. `holdsCount` is the length of the queue, not *your place in it*. Path 2 is a catalog view, not an account view — it has no notion of "you."

---

## Path 3 — other Libby surfaces (evaluated, rejected for per-hold state)

- **Email hold notices.** Libby emails "your hold is ready." Push-only, only fires on the *ready* transition, carries no position/wait/queue for the non-ready holds, is delivered to the patron's mailbox (not a pollable endpoint), and is unstructured. Cannot give per-hold state on demand. **Rejected.**
- **Timeline / reading-history export** (`booklife-mcp`'s `import-timeline`). A patron-exported JSON of *reading* activity, not a live queue; manual, not a pollable API, and does not expose queue position. **Rejected.**

Neither yields the per-hold {position, wait, ready-flag, card} triple the feature needs.

---

## Integration points (what reader would change)

### `packages/server/src/storage/types.ts` — `CredentialProvider` + `CredentialSecret`
- Add `"libby"` to `CredentialProvider` (types.ts:25).
- **Path 1 credential:** the secret is the bearer `identity` JWT. Maps to `CredentialSecret { kind: "bearer"; token }` (types.ts:29) — but bearer secrets today have **no expiry field**, so a 7-day token would silently rot. Either add an `expiresAt` to the bearer variant or store as `oauth2` with `expiresAt` and a null `refreshToken` (the code already treats "expired + no refresh token" as *reconnect required* — see `refreshOAuth` credentials.ts:70). The latter needs no new variant and is the honest model: Libby has no refresh, so the credential is a fixed-expiry bearer.
- **Origin:** `https://sentry-read.svc.overdrive.com`. `authorizationFor` (credentials.ts:105) pins a credential to exactly one `scheme://host[:port]` and refuses any other — correct here, because the sync calls go only to that host. Path 2 needs **no credential** at all, so a hybrid design stores one Libby bearer credential (sentry origin) and calls thunder anonymously.
- **SSRF guard:** `assertPublicUrl` passes for both hosts (public IPs). But note the **TLS hostname mismatch on sentry** breaks reader's undici fetch — Path 1 is the *only* reader integration point that cannot reuse `fetchCapped` unchanged (a custom agent with `rejectUnauthorized:false` would be needed, which is a security regression worth flagging to the security posture in AGENTS.md).

### `packages/server/src/ingestors/types.ts` — cursor
- `IngestorAdapter.fetch` returns `{ items, cursor }` (types.ts:3); cursor is a free `Record<string,unknown>` like reddit's `{after}` / mastodon's `{minId}`.
- A Libby hold has **no monotonic id or timestamp** that advances on queue-position change — position/wait change without any field incrementing. So a keyset/`since` cursor cannot detect "I moved from #40 to #12." The cursor must instead hold a **per-hold snapshot** (map of `holdId → {position, estimatedWaitDays, isAvailable, expireDate, cardId}` plus the last `result`), and the adapter diffs the new sync against it to emit a change item only when a held title's state transitions (moved, became ready, borrowed, expired). That is a state-diff cursor, not a paging cursor — the important design consequence.

---

## Options and their cost

- **Option A — Path 1 only (private sync).** Gives the true account view (position, wait, ready, card, your dates) in one call. Cost: ToS breach; fragile (TLS-mismatch, code-direction reversal, shape drift); **7-day token with no refresh → needs the operator to re-supply a setup code every week**, which makes a server-side ingestor unworkable unattended; requires weakening `fetchCapped`'s TLS verification (a security regression). Highest data fidelity, highest operational and legal cost.
- **Option B — Path 2 only (public availability).** Sanctioned-ish public catalog, no credentials, TLS-clean, drop-in for the fetch stack, no token to rot. Cost: **cannot give queue position or personalized wait** — only `holdsCount` (whole queue) and library availability. Can show "N people ahead-of-everyone, 0 copies, not available" but never "you're #12." Feature is materially weaker than the brief's "position and wait."
- **Option C — Hybrid (Path 2 primary, Path 1 bootstrap-on-demand).** Poll Path 2 for all holds (available/copies/holdsCount, anonymous, robust); use Path 1 **only** to seed the patron's hold list once (titles + card binding + one position snapshot) and to catch the `ready-for-loan` transition, accepting the weekly manual re-auth. Cost: inherits Path 1's ToS/fragility but *contains* it — a failure there degrades to Path 2 rather than breaking the feature; most code stays on the clean path.

---

## Recommendation

**Option C (hybrid), conditional on the operator explicitly accepting Path 1's ToS/fragility.** Build the reader ingestor so the steady-state queue view comes from **Path 2** (credential-free, TLS-clean, no token to rot, drop-in for `fetchCapped`), and reserve **Path 1** solely for the per-patron *seed* (which titles are held, on which card) and the *ready* transition that only the account API can see. Do **not** make Path 1 the polling backbone: the 7-day, refresh-less, TLS-broken, ToS-hostile nature of the sync token makes an unattended poller both a legal and an operational liability, and `refreshOAuth` already has no refresh token to call.

If the operator declines Path 1's ToS/fragility, fall back to **Option B**: reader reports library-level availability (`holdsCount`, `availableCopies`, `isAvailable`) and shows "not in your hand yet" without a position number — honest and unbreakable, and no private endpoint is ever called.

Credential model the recommendation implies (Path 1 seed only):
- **provider:** `"libby"`
- **secret kind:** `oauth2` with `accessToken = identity` JWT, `expiresAt = mint+7d`, `refreshToken: null` (Libby has no refresh — re-auth is a manual re-clone). This reuses the existing expired-no-refresh → "reconnect" path verbatim; no new secret variant.
- **origin:** `https://sentry-read.svc.overdrive.com` (the only host the token is ever sent to; `authorizationFor` enforces this).
- **refresh handling:** none — a 401/404 on `/chip/sync` marks the credential broken and prompts the patron to re-supply a setup code via the same clone flow (`chip-info.mjs`→`probe.mjs`).
- **revoke path:** patron deletes the `libby` credential (storage `deleteCredential`); because there is no server-held refresh, nothing else persists. The phone is unaffected (adding a device ≠ evicting it) — pending confirmation below.

---

## Pending — operator input via the question door

The two items that require the user's live Libby card (the spike cannot and must not fabricate them):

1. **The real `holds[]` capture.** Operator runs, locally, using the legacy code path that generates a phone-side code (Libby → Copy To Another Device → the Sonos / Android Auto sub-option), then pastes the **redacted** stdout:
   ```
   LIBBY_SETUP_CODE=<8-digit code> node scripts/spikes/libby/probe.mjs
   ```
   Needed to confirm: full hold field set (`holdListPosition`, `estimatedWaitDays`, `placedDate`, `expireDate`, per-card binding); that a single `/chip/sync` returns all cards/holds for the account; whether `clone` returns a re-minted `identity`; and whether cloning evicted the phone.
2. **ToS/fragility acceptance for Path 1** (private sync API use) and confirmation of the re-clone/phone-out behaviour. The Recommendation is **conditional on answer #2**; record the operator's verbatim yes/no here and adjust toward Option B if declined.

---

## Verification

- **Live non-secret probes (2026-09-19), all in this doc:** `POST /chip?client=dewey` → `200 {chip, identity(JWT), syncable, primary}`; identity JWT `exp = mint + 168.0h` (7 days, no `iat`, no refresh token); `POST /chip/clone/code` with an eight-zero code → `404 {"result":"not_found"}`; `GET /v2/libraries/clevnet/media/<public-id>` → `200` with `isAvailable/availableCopies/ownedCopies/holdsCount`, and `estimatedWaitDays`/`holdListPosition` **absent**. TLS SANs inspected with `openssl s_client` (sentry-read = `*.odrsre.overdrive.com` mismatch; thunder = `*.api.overdrive.com` clean).
- **Setup-code grep gate:** `git grep -nE '[0-9]{8}' docs/spikes/libby-holds-access.md scripts/spikes/libby` returns **nothing** (public media id masked; the invalid-code example is written as prose, not a literal). No token/code/barcode is stored or printed by the scripts (`lib.mjs redact()`).
- **Tests:** the spike adds **no production code** — `git status` shows only `docs/spikes/` and `scripts/spikes/`; no `packages/*`/`apps/*` `tsconfig` or `vitest` config references `scripts/`, so it is inert to the build. `@reader/core` (48) and `@reader/web` (32, incl. its `tsc --noEmit`) pass (`rc=0`). `@reader/server`'s failures are a **pre-existing better-sqlite3 ABI mismatch in this sandbox** (the bundled `better_sqlite3.node` is dated Jun 15 and does not self-register under the runtime's Node 20 / module-ABI 115; a cached `pnpm rebuild` no-ops it). Failure counts are byte-identical pre- and post-change (`127 failed | 51 passed`) with **zero** non-native logic failures — i.e. unrelated to and unaffected by this spike. In a correctly provisioned environment (the deploy host runs Node 24 with a matching prebuilt), the full suite is green.
- **Not finished (operator-gated):** the real `holds[]` redacted capture, the clone-success shape / re-mint / phone-eviction observation, the held-title Path-2 capture, and the Path-1 ToS acceptance — all require the operator's live 8-digit setup code, run through the question door (see Pending).
