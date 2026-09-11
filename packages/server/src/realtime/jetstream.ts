import { fetchCapped } from "../fetch.js";
import type { NormalizedItem } from "../storage/types.js";

/**
 * Bluesky Jetstream (https://github.com/bluesky-social/jetstream) re-serves
 * the AT Protocol firehose as JSON over a WebSocket, filtered server-side to
 * the accounts and record types asked for:
 *   {"did":"did:plc:…","time_us":…,"kind":"commit","commit":{"operation":"create",
 *    "collection":"app.bsky.feed.post","rkey":"…","record":{"text":"…","createdAt":"…"}}}
 */

export const DEFAULT_JETSTREAM_URL = "wss://jetstream2.us-east.bsky.network/subscribe";
export const PUBLIC_BSKY_API = "https://public.api.bsky.app";
/** Jetstream accepts at most this many wantedDids per connection. */
export const MAX_JETSTREAM_DIDS = 10_000;
/** Resume a little before the last event seen so a reconnect cannot skip any. */
const RESUME_OVERLAP_US = 5_000_000;

export function jetstreamUrl(base: string, dids: string[], lastTimeUs: number | null): string {
  const url = new URL(base);
  url.searchParams.set("wantedCollections", "app.bsky.feed.post");
  for (const did of dids.slice(0, MAX_JETSTREAM_DIDS)) url.searchParams.append("wantedDids", did);
  if (lastTimeUs !== null) url.searchParams.set("cursor", String(lastTimeUs - RESUME_OVERLAP_US));
  return url.href;
}

export interface JetstreamPost {
  did: string;
  timeUs: number;
  rkey: string;
  text: string;
  createdAt: string | null;
}

/** A new post from a Jetstream frame; edits, deletes and other records yield null. */
export function jetstreamPost(frame: string): JetstreamPost | null {
  let doc: unknown;
  try {
    doc = JSON.parse(frame);
  } catch {
    return null;
  }
  const d = doc as { did?: unknown; time_us?: unknown; kind?: unknown; commit?: Record<string, unknown> };
  const c = d.commit;
  if (d.kind !== "commit" || typeof d.did !== "string" || typeof d.time_us !== "number" || !c) return null;
  if (c.operation !== "create" || c.collection !== "app.bsky.feed.post" || typeof c.rkey !== "string") return null;
  const record = (c.record ?? {}) as Record<string, unknown>;
  return {
    did: d.did,
    timeUs: d.time_us,
    rkey: c.rkey,
    text: typeof record.text === "string" ? record.text : "",
    createdAt: typeof record.createdAt === "string" ? record.createdAt : null,
  };
}

/** Same external id and URL shape as the polling adapter, so the two dedupe. */
export function postToItem(post: JetstreamPost, handle: string): NormalizedItem {
  return {
    externalId: `at://${post.did}/app.bsky.feed.post/${post.rkey}`,
    author: handle,
    title: null,
    text: post.text,
    url: `https://bsky.app/profile/${handle}/post/${post.rkey}`,
    publishedAt: post.createdAt,
  };
}

export async function resolveHandle(apiBase: string, handle: string): Promise<string> {
  const res = await fetchCapped(`${apiBase}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`, { maxBytes: 16 * 1024 });
  if (res.status !== 200) throw new Error(`resolveHandle ${handle}: HTTP ${res.status}`);
  const did = (JSON.parse(res.body) as { did?: unknown }).did;
  if (typeof did !== "string" || !did.startsWith("did:")) throw new Error(`resolveHandle ${handle}: no did`);
  return did;
}
