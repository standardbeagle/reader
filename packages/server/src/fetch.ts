export const MAX_FEED_BYTES = 10 * 1024 * 1024;

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
  const res = await fetch(url, {
    headers: {
      "user-agent": "reader/0.1 (+local)",
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, text/html, */*",
      ...opts.headers,
    },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    redirect: "follow",
  });
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
  return { status: res.status, headers: res.headers, finalUrl: res.url, body: Buffer.concat(chunks).toString("utf8") };
}
