// Path 2: public availability for one OverDrive title. No credentials.
// Usage: LIBRARY_KEY=<key> TITLE_ID=<id> node scripts/spikes/libby/availability.mjs
import { thunder, redact, show } from "./lib.mjs";

const lib = process.env.LIBRARY_KEY;
const title = process.env.TITLE_ID;
if (!lib || !title) {
  console.error("set LIBRARY_KEY and TITLE_ID (from probe.mjs hold output or a libby share link)");
  process.exit(1);
}

const res = await thunder(`/v2/libraries/${encodeURIComponent(lib)}/media/${encodeURIComponent(title)}`);
show(`GET /v2/libraries/${lib}/media/${title} → status`, {
  status: res.status, contentType: res.headers["content-type"],
  retryAfter: res.headers["retry-after"], ratelimit: res.headers["x-ratelimit-remaining"],
});
if (res.status !== 200) { console.log("body:", redact(res.json ?? res.text)); process.exit(1); }

const m = res.json;
show("top-level keys", Object.keys(m));
show("redacted full response", redact(m));
show("availability-relevant fields", {
  "copies": m.copies,
  "holdsTotal": m.holdsTotal,
  "instantAvailable": m.instantAvailable,
  "firstAvailableFormat": (m.formats ?? []).map((f) => ({ id: f.id, "availability": f.copies })),
} );
