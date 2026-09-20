// Path 1 full chain: clone an anonymous chip into the operator's account using a
// Libby setup code, then sync and dump the REDACTED holds/cards shape, plus a
// matching Path 2 (thunder) availability capture for the first held title.
//
//   LIBBY_SETUP_CODE=<8 digits> node scripts/spikes/libby/probe.mjs
//
// The setup code is read ONLY from the environment. Nothing here prints the
// code, the identity token, a card number, or a barcode. Run locally; the
// operator pastes the redacted stdout into the spike doc.
import { chip, thunder, decodeJwt, lifetimeInfo, redact, show } from "./lib.mjs";

const code = (process.env.LIBBY_SETUP_CODE ?? "").trim();
if (!/^\d{8}$/.test(code)) {
  console.error("LIBBY_SETUP_CODE must be an 8-digit code (Libby > Copy To Another Device).");
  process.exit(1);
}

// A) mint a fresh anonymous chip.
const mint = await chip("POST", "/chip", { query: { client: "dewey" } });
if (mint.status !== 200 || !mint.json?.identity) {
  console.error("mint failed", mint.status, redact(mint.json ?? mint.text));
  process.exit(1);
}
const identity = mint.json.identity;
const claims = decodeJwt(identity);
show("A) minted chip → token lifetime (now→exp; no iat, no refresh token)", {
  present: !!(claims?.exp), expISO: claims?.exp ? new Date(claims.exp * 1000).toISOString() : null,
  remainingHours: claims?.exp ? ((claims.exp - Date.now() / 1000) / 3600).toFixed(1) : null,
  claimsBeforeClone: { aud: claims?.aud, iss: claims?.iss, cards: claims?.chip?.cards ?? null },
});

// B) clone (enter the code generated on the phone). Capture the raw SHAPE
// (keys) without echoing any token. A 4xx here is itself the evidence.
const clone = await chip("POST", "/chip/clone/code", { form: { code }, token: identity });
show("B) POST /chip/clone/code → status", { status: clone.status, contentType: clone.headers["content-type"] });
console.log("clone response top-level keys:", clone.json ? Object.keys(clone.json) : "(non-json)");
show("B) clone response (redacted)", redact(clone.json ?? clone.text));
const reMint = clone.json?.identity ? "clone returned a NEW identity (re-mint)" : "clone kept the same identity";
console.log("re-mint signal:", reMint);
if (clone.status !== 200) { console.error("\nCLONE REJECTED — likely the modern (recover-on-this-device) code direction. See doc."); process.exit(2); }
const useToken = clone.json?.identity ?? identity;

// C) sync the whole account state.
const sync = await chip("GET", "/chip/sync", { token: useToken });
if (sync.status !== 200) { console.error("sync failed", sync.status, redact(sync.json ?? sync.text)); process.exit(1); }
const s = sync.json;
show("C) GET /chip/sync → result + collection sizes", {
  result: s.result,
  topKeys: Object.keys(s),
  cards: (s.cards ?? []).length, loans: (s.loans ?? []).length, holds: (s.holds ?? []).length,
  "all cards in ONE sync?": `${(s.cards ?? []).length} card(s) returned by a single /chip/sync`,
});
show("C) holds[0] SHAPE (redacted)", (s.holds ?? []).length ? redact(s.holds[0]) : "no holds");
show("C) hold field presence (the spike's hypotheses)", (() => {
  const h = (s.holds ?? [])[0] ?? {};
  const probe = (o) => Object.keys(o).filter((k) => !/^[A-Z]/.test(k));
  return { presentKeys: probe(h), estimatedWaitDays: "estimatedWaitDays" in h ? h.estimatedWaitDays : "(absent)", holdListPosition: "holdListPosition" in h ? h.holdListPosition : "(absent)", isAvailable: "isAvailable" in h ? h.isAvailable : "(absent)" };
})());
show("C) cards[0] SHAPE (redacted)", (s.cards ?? []).length ? redact(s.cards[0]) : "no cards");

// D) Path 2 capture for one ACTUALLY held title, driven by the sync.
const hold = (s.holds ?? [])[0];
const card = (s.cards ?? []).find((c) => c.id === hold?.cardId);
const libKey = card?.library?.key ?? card?.library?.preferredKey;
const titleId = hold?.id;
if (libKey && titleId) {
  const av = await thunder(`/v2/libraries/${libKey}/media/${titleId}`);
  show(`D) Path 2 availability for held title "${hold.title}" (libraryKey=${libKey})`, {
    status: av.status, isAvailable: av.json?.isAvailable, availableCopies: av.json?.availableCopies,
    ownedCopies: av.json?.ownedCopies, holdsCount: av.json?.holdsCount,
    estimatedWaitDays: "estimatedWaitDays" in (av.json ?? {}) ? av.json.estimatedWaitDays : "(absent from Path 2)",
  });
  console.log("compare — Path1 hold vs Path2 media, same title:");
  console.log(JSON.stringify({ path1: { pos: hold.holdListPosition, wait: hold.estimatedWaitDays, available: hold.isAvailable, count: hold.holdsCount }, path2: { available: av.json?.isAvailable, availCopies: av.json?.availableCopies, owned: av.json?.ownedCopies, holdsCount: av.json?.holdsCount } }, null, 2));
} else {
  console.log("\nD) skipped: could not resolve libraryKey+titleId from sync (shape drift?)");
}

show("E) final token lifetime after clone+sync (does cloning change exp?)", lifetimeInfo(decodeJwt(useToken)));
