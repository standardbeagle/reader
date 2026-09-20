// Throwaway Libby/OverDrive spike probes. NEVER imported by packages/server.
// Self-contained: node built-ins only, secrets read from env vars, PII redacted.
//
// Endpoints reverse-engineered from github.com/ping/libby-calibre-plugin
// (calibre-plugin/libby/client.py). This spike verifies them against the real
// service; it does not reimplement production logic.
import https from "node:https";

export const SENTRY_BASE = { host: "sentry-read.svc.overdrive.com", port: 443 };
export const THUNDER_HOST = "thunder.api.overdrive.com";

// Libby's own client headers (see client.py default_headers()).
const BASE_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 11_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.2 Safari/605.1.15",
  accept: "application/json",
  referer: "https://libbyapp.com/",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "accept-encoding": "identity", // avoid gzip so we can read plaintext
};

function rawRequest({ host, path, method, headers, body, insecure }) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host, port: 443, path, method, headers, rejectUnauthorized: !insecure, timeout: 20000 },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try { json = JSON.parse(text); } catch { /* leave null */ }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    if (body !== undefined && body !== null) req.write(body);
    req.end();
  });
}

// Path 1 — sentry-read. Its TLS cert (CN=*.odrsre.overdrive.com) does not match
// this hostname, so hostname verification must be off (insecure: true).
export function chip(method, path, { query, form, json, token } = {}) {
  const qs = query ? "?" + new URLSearchParams(query).toString() : "";
  const headers = { ...BASE_HEADERS };
  if (token) headers.authorization = `Bearer ${token}`;
  let body;
  if (form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(form).toString();
  } else if (json !== undefined) {
    headers["content-type"] = "application/json; charset=UTF-8";
    body = JSON.stringify(json);
  }
  return rawRequest({ ...SENTRY_BASE, path: path + qs, method, headers, body, insecure: true });
}

// Path 2 — thunder, public, no credentials, hostname-clean cert.
export function thunder(path) {
  return rawRequest({
    host: THUNDER_HOST,
    port: 443,
    path,
    method: "GET",
    headers: { ...BASE_HEADERS, accept: "application/json" },
    insecure: false,
  });
}

// ---- redaction -----------------------------------------------------------

// Keys whose VALUES are account-identifying or bearer tokens: never show them.
const SECRET_KEYS = new Set([
  "identity", "token", "authorization", "accesstoken", "refreshtoken",
  "barcode", "cardnumber", "username", "password", "pin", "email",
  "emailaddress", "librarycardbarcode", "code", "secret", "patron",
]);

const looksIdish = (s) =>
  typeof s === "string" && s.length >= 18 && /^[A-Za-z0-9_\-:.]+$/.test(s);

// Recursively mask secrets while preserving STRUCTURE (key names, types, counts)
// so the doc can show the response shape without exposing the person.
export function redact(value, key = "") {
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    // Keep at most one exemplar element, deeply redacted.
    return [redact(value[0], key), `…+${value.length - 1} more`];
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEYS.has(k.toLowerCase()) ? "<redacted>" : redact(v, k);
    return out;
  }
  if (typeof value === "string") {
    if (SECRET_KEYS.has(key.toLowerCase())) return "<redacted>";
    // A bare JWT (three dot-separated base64url segments) is a token.
    if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return "<jwt>";
    if (looksIdish(value)) return value.slice(0, 4) + "…" + value.slice(-2) + `(${value.length})`;
    return value;
  }
  return value; // number, boolean, null kept verbatim (they are the point)
}

export function decodeJwt(token) {
  try {
    const [, payload] = token.split(".");
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function lifetimeInfo(claims) {
  if (!claims || !claims.iat || !claims.exp) return null;
  const hrs = (claims.exp - claims.iat) / 3600;
  return {
    issuedAt: new Date(claims.iat * 1000).toISOString(),
    expiresAt: new Date(claims.exp * 1000).toISOString(),
    lifetimeHours: Math.round(hrs * 10) / 10,
  };
}

export function show(label, obj) {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(obj, null, 2));
}
