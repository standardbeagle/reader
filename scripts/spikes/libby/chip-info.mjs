// Path 1 step A only: mint an anonymous device chip and report the token's
// structure + lifetime. No user secret involved — safe to run.
// Usage: node scripts/spikes/libby/chip-info.mjs
import { chip, decodeJwt, lifetimeInfo, redact, show } from "./lib.mjs";

const res = await chip("POST", "/chip", { query: { client: "dewey" } });
show("POST /chip?client=dewey → status", { status: res.status, contentType: res.headers["content-type"] });
show("response header NAMES", Object.keys(res.headers));
show("selected response headers", {
  server: res.headers["server"], cfRay: res.headers["cf-ray"], via: res.headers["via"],
});

if (res.status !== 200 || !res.json?.identity) {
  console.log("mint failed; redacted body:", redact(res.json ?? res.text));
  process.exit(1);
}

console.log("\ntop-level keys:", Object.keys(res.json));
show("redacted mint response (identity value masked)", redact(res.json));

const claims = decodeJwt(res.json.identity);
console.log("\nJWT claim NAMES (values below are the anonymous device, not a person):");
if (claims) {
  const safe = {};
  for (const k of Object.keys(claims)) safe[k] = ["iat", "exp", "nbf"].includes(k) ? claims[k] : redact(String(claims[k]), k);
  show("claims + derived lifetime", { claims: safe, lifetime: lifetimeInfo(claims) });
}
