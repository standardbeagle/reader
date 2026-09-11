import type { Ingestor, NormalizedItem, Storage } from "../storage/types.js";
import type { Poller } from "../poller/poller.js";
import type { IngestorEngine } from "../ingestors/engine.js";
import { ReconnectingSocket, type SocketStatus } from "./socket.js";
import { feedKey, podpingIris } from "./podping.js";
import { jetstreamPost, jetstreamUrl, postToItem, resolveHandle, PUBLIC_BSKY_API } from "./jetstream.js";
import { mastodonBase, statusToItem, streamingBase } from "../ingestors/mastodon.js";
import { streamingTokenFor } from "../auth/credentials.js";

const RECONCILE_MS = 60_000;
/** A feed pinged repeatedly (live shows ping often) is refreshed at most this often. */
const PODPING_MIN_REFRESH_MS = 60_000;
/** Streamed posts are batched per ingestor so the LLM sees groups, not single posts. */
const STREAM_BATCH_MS = 5_000;
const STREAM_BATCH_MAX = 25;
const MAX_MASTODON_STREAMS = 32;
const STREAMING_BASE_TTL_MS = 6 * 60 * 60_000;

export interface RealtimeOptions {
  /** Podping relay; null disables Podping. */
  podpingUrl: string | null;
  /** Jetstream endpoint; null disables Bluesky streaming. */
  jetstreamUrl: string | null;
  /** Mastodon streaming for ingestors with a connected account. */
  mastodonStreaming: boolean;
  bskyApiBase?: string;
  reconcileMs?: number;
  streamBatchMs?: number;
}

interface MastodonStream { socket: ReconnectingSocket; ingestorIds: string[] }

/**
 * Owns every outbound real-time stream. Once a minute it compares the
 * streams it has with the ones the subscriptions call for, opening and
 * closing sockets to match, so new subscriptions need no wiring of their own.
 * Polling stays the source of truth; streams only make updates arrive sooner.
 */
export class RealtimeHub {
  private timer: NodeJS.Timeout | null = null;
  private reconciling: Promise<void> | null = null;
  private stopped = false;

  private podping: ReconnectingSocket | null = null;
  private podcastFeeds = new Map<string, string>();
  private lastPodpingRefresh = new Map<string, number>();
  private podpingMatches = 0;

  private mastodon = new Map<string, MastodonStream>();
  private streamingBases = new Map<string, { url: string; at: number }>();

  private jetstream: { socket: ReconnectingSocket; didsKey: string } | null = null;
  private jetstreamTargets = new Map<string, { ingestorId: string; handle: string }[]>();
  private jetstreamLastTimeUs: number | null = null;
  private dids = new Map<string, string>();

  private batches = new Map<string, { items: NormalizedItem[]; timer: NodeJS.Timeout }>();
  private lastError: string | null = null;

  constructor(
    private readonly storage: Storage,
    private readonly poller: Poller,
    private readonly engine: IngestorEngine,
    private readonly opts: RealtimeOptions,
  ) {}

  start(): void {
    void this.reconcile();
    this.timer = setInterval(() => { void this.reconcile(); }, this.opts.reconcileMs ?? RECONCILE_MS);
    this.timer.unref();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.podping?.close();
    this.podping = null;
    for (const s of this.mastodon.values()) s.socket.close();
    this.mastodon.clear();
    this.jetstream?.socket.close();
    this.jetstream = null;
    for (const b of this.batches.values()) clearTimeout(b.timer);
    this.batches.clear();
  }

  /** Bring the open streams in line with the subscriptions. Concurrent calls share one run. */
  reconcile(): Promise<void> {
    if (this.reconciling) return this.reconciling;
    this.reconciling = (async () => {
      try {
        this.reconcilePodping();
        const ingestors = this.storage.listIngestors(this.storage.getOrCreateLocalUser().id).filter((i) => i.status === "ok");
        await this.reconcileMastodon(ingestors);
        await this.reconcileJetstream(ingestors);
        this.lastError = null;
      } catch (e) {
        this.lastError = e instanceof Error ? e.message : String(e);
      } finally {
        this.reconciling = null;
      }
    })();
    return this.reconciling;
  }

  status() {
    const sockets = [this.podping, this.jetstream?.socket ?? null, ...[...this.mastodon.values()].map((s) => s.socket)];
    return {
      streams: sockets.filter((s): s is ReconnectingSocket => s !== null).map((s): SocketStatus => ({ ...s.status })),
      podping: { enabled: this.opts.podpingUrl !== null, watchedFeeds: this.podcastFeeds.size, matches: this.podpingMatches },
      jetstream: { enabled: this.opts.jetstreamUrl !== null, accounts: this.jetstreamTargets.size },
      mastodon: { enabled: this.opts.mastodonStreaming, streams: this.mastodon.size },
      lastError: this.lastError,
    };
  }

  // ── Podping ────────────────────────────────────────────────────────────

  private reconcilePodping(): void {
    const url = this.opts.podpingUrl;
    this.podcastFeeds = new Map(
      this.storage.podcastFeeds().flatMap((f) => { const key = feedKey(f.url); return key ? [[key, f.id] as const] : []; }),
    );
    const wanted = url !== null && this.podcastFeeds.size > 0;
    if (wanted && !this.podping) {
      this.podping = new ReconnectingSocket({ name: "podping", url: () => url, onMessage: (frame) => this.onPodping(frame) });
    } else if (!wanted && this.podping) {
      this.podping.close();
      this.podping = null;
    }
  }

  private onPodping(frame: string): void {
    const now = Date.now();
    for (const iri of podpingIris(frame)) {
      const key = feedKey(iri);
      const feedId = key ? this.podcastFeeds.get(key) : undefined;
      if (!feedId) continue;
      if (now - (this.lastPodpingRefresh.get(feedId) ?? 0) < PODPING_MIN_REFRESH_MS) continue;
      this.lastPodpingRefresh.set(feedId, now);
      this.podpingMatches++;
      void this.poller.refreshFeed(feedId).catch(() => { /* recorded on the feed like any poll error */ });
    }
  }

  // ── Mastodon streaming API ─────────────────────────────────────────────

  private async streamingBaseFor(instanceBase: string): Promise<string> {
    const hit = this.streamingBases.get(instanceBase);
    if (hit && Date.now() - hit.at < STREAMING_BASE_TTL_MS) return hit.url;
    const url = await streamingBase(instanceBase);
    this.streamingBases.set(instanceBase, { url, at: Date.now() });
    return url;
  }

  /** The stream an ingestor maps to: its account's home timeline, or a hashtag. */
  private async mastodonStreamUrl(ing: Ingestor): Promise<string | null> {
    const credentialId = ing.config.credentialId;
    if (typeof credentialId !== "string") return null;
    const stream = ing.config.timeline === "home"
      ? "stream=user"
      : typeof ing.config.tag === "string" ? `stream=hashtag&tag=${encodeURIComponent(ing.config.tag)}` : null;
    if (!stream) return null;
    return `${await this.streamingBaseFor(mastodonBase(ing.config))}/api/v1/streaming?${stream}`;
  }

  private async reconcileMastodon(ingestors: Ingestor[]): Promise<void> {
    const wanted = new Map<string, { url: string; credentialId: string; ingestorIds: string[] }>();
    if (this.opts.mastodonStreaming) {
      for (const ing of ingestors.filter((i) => i.kind === "mastodon")) {
        const url = await this.mastodonStreamUrl(ing).catch(() => null);
        if (!url) continue;
        const credentialId = ing.config.credentialId as string;
        const key = `${url}#${credentialId}`;
        const entry = wanted.get(key) ?? { url, credentialId, ingestorIds: [] };
        entry.ingestorIds.push(ing.id);
        wanted.set(key, entry);
      }
    }
    for (const [key, stream] of this.mastodon) {
      if (!wanted.has(key)) { stream.socket.close(); this.mastodon.delete(key); }
    }
    for (const [key, want] of wanted) {
      const existing = this.mastodon.get(key);
      if (existing) { existing.ingestorIds = want.ingestorIds; continue; }
      if (this.mastodon.size >= MAX_MASTODON_STREAMS) break;
      const stream: MastodonStream = { ingestorIds: want.ingestorIds, socket: null as unknown as ReconnectingSocket };
      stream.socket = new ReconnectingSocket({
        name: `mastodon ${new URL(want.url).host} ${new URL(want.url).searchParams.get("stream")}`,
        url: () => want.url,
        // Mastodon reads the token from Sec-WebSocket-Protocol, which keeps it out of URLs and logs.
        protocols: async () => [await streamingTokenFor(this.storage, want.credentialId, want.url)],
        onMessage: (frame) => this.onMastodon(frame, stream.ingestorIds),
      });
      this.mastodon.set(key, stream);
    }
  }

  private onMastodon(frame: string, ingestorIds: string[]): void {
    const event = JSON.parse(frame) as { event?: unknown; payload?: unknown };
    if (event.event !== "update" || typeof event.payload !== "string") return;
    const item = statusToItem(JSON.parse(event.payload) as Record<string, unknown>);
    for (const id of ingestorIds) this.enqueue(id, item);
  }

  // ── Bluesky Jetstream ──────────────────────────────────────────────────

  private async reconcileJetstream(ingestors: Ingestor[]): Promise<void> {
    const base = this.opts.jetstreamUrl;
    const targets = new Map<string, { ingestorId: string; handle: string }[]>();
    if (base) {
      for (const ing of ingestors.filter((i) => i.kind === "bluesky" && typeof i.config.handle === "string")) {
        const handle = String(ing.config.handle).replace(/^@/, "").toLowerCase();
        let did = this.dids.get(handle);
        if (!did) {
          did = await resolveHandle(this.opts.bskyApiBase ?? PUBLIC_BSKY_API, handle).catch(() => undefined);
          if (!did) continue; // retried next reconcile
          this.dids.set(handle, did);
        }
        targets.set(did, [...(targets.get(did) ?? []), { ingestorId: ing.id, handle }]);
      }
    }
    this.jetstreamTargets = targets;
    const dids = [...targets.keys()].sort();
    const didsKey = dids.join(",");
    if (this.jetstream && this.jetstream.didsKey === didsKey) return;
    this.jetstream?.socket.close();
    this.jetstream = null;
    if (!base || dids.length === 0) return;
    this.jetstream = {
      didsKey,
      socket: new ReconnectingSocket({
        name: "bluesky jetstream",
        url: () => jetstreamUrl(base, dids, this.jetstreamLastTimeUs),
        onMessage: (frame) => this.onJetstream(frame),
      }),
    };
  }

  private onJetstream(frame: string): void {
    const post = jetstreamPost(frame);
    if (!post) return;
    this.jetstreamLastTimeUs = post.timeUs;
    for (const target of this.jetstreamTargets.get(post.did) ?? []) {
      this.enqueue(target.ingestorId, postToItem(post, target.handle));
    }
  }

  // ── Batching into the ingestor engine ──────────────────────────────────

  private enqueue(ingestorId: string, item: NormalizedItem): void {
    if (this.stopped) return;
    const batch = this.batches.get(ingestorId);
    if (batch) {
      batch.items.push(item);
      if (batch.items.length >= STREAM_BATCH_MAX) this.flush(ingestorId);
      return;
    }
    const timer = setTimeout(() => this.flush(ingestorId), this.opts.streamBatchMs ?? STREAM_BATCH_MS);
    timer.unref();
    this.batches.set(ingestorId, { items: [item], timer });
  }

  private flush(ingestorId: string): void {
    const batch = this.batches.get(ingestorId);
    if (!batch) return;
    clearTimeout(batch.timer);
    this.batches.delete(ingestorId);
    void this.engine.ingestStreamed(ingestorId, batch.items);
  }
}
