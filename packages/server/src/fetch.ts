import { assertPublicUrl } from "./net-guard.js";

export const MAX_FEED_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 5;

export interface CappedResponse {
  status: number;
  headers: Headers;
  finalUrl: string;
  body: string;
}

export async function fetchCapped(
  url: string,
  opts: { headers?: Record<string, string>; timeoutMs?: number; maxBytes?: number } = {},
): Promise<CappedResponse> {
  const max = opts.maxBytes ?? MAX_FEED_BYTES;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 15_000);
  // Follow redirects by hand so the SSRF guard re-validates every hop — a public
  // URL that 30x-redirects to 169.254.169.254 must still be refused.
  let current = url;
  let res: Response;
  for (let hop = 0; ; hop++) {
    await assertPublicUrl(current);
    res = await fetch(current, {
      headers: {
        "user-agent": "reader/0.1 (+local)",
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, text/html, */*",
        ...opts.headers,
      },
      signal,
      redirect: "manual",
    });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) break;
    if (hop >= MAX_REDIRECTS) throw new Error("too many redirects");
    await res.body?.cancel().catch(() => {});
    current = new URL(location, current).href;
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
