import { assertPublicUrl } from "./net-guard.js";

export const MAX_FEED_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 5;

export interface CappedResponse {
  status: number;
  headers: Headers;
  finalUrl: string;
  body: string;
}

// Credentials are scoped to the origin they were issued for; a redirect to
// another host must not carry them along.
const CREDENTIAL_HEADERS = new Set(["authorization", "cookie", "proxy-authorization"]);

function withoutCredentials(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !CREDENTIAL_HEADERS.has(name.toLowerCase())));
}

export async function fetchCapped(
  url: string,
  opts: { headers?: Record<string, string>; timeoutMs?: number; maxBytes?: number; method?: "GET" | "POST"; body?: string } = {},
): Promise<CappedResponse> {
  const max = opts.maxBytes ?? MAX_FEED_BYTES;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 15_000);
  const method = opts.method ?? "GET";
  let headers: Record<string, string> = {
    "user-agent": "reader/0.1 (+local)",
    accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, text/html, */*",
    ...opts.headers,
  };
  // Follow redirects by hand so the SSRF guard re-validates every hop — a public
  // URL that 30x-redirects to 169.254.169.254 must still be refused.
  let current = url;
  let res: Response;
  for (let hop = 0; ; hop++) {
    await assertPublicUrl(current);
    res = await fetch(current, {
      method,
      headers,
      ...(opts.body !== undefined ? { body: opts.body } : {}),
      signal,
      redirect: "manual",
    });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) break;
    await res.body?.cancel().catch(() => {});
    // A POST (token exchange) that redirects is a misconfigured endpoint;
    // replaying the body — with its secrets — to a new URL is never right.
    if (method !== "GET") throw new Error(`unexpected redirect from ${method} ${current}`);
    if (hop >= MAX_REDIRECTS) throw new Error("too many redirects");
    const next = new URL(location, current);
    if (next.origin !== new URL(current).origin) headers = withoutCredentials(headers);
    current = next.href;
  }
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > max) throw new Error(`response too large (>${Math.round(max / 1e6)}MB)`);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of res.body ?? []) {
    const buf = Buffer.from(chunk as Uint8Array);
    size += buf.length;
    if (size > max) throw new Error(`response too large (>${Math.round(max / 1e6)}MB)`);
    chunks.push(buf);
  }
  return { status: res.status, headers: res.headers, finalUrl: current, body: Buffer.concat(chunks).toString("utf8") };
}
