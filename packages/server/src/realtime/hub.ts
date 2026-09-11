import type { Storage } from "../storage/types.js";
import type { Poller } from "../poller/poller.js";
import { ReconnectingSocket, type SocketStatus } from "./socket.js";
import { feedKey, podpingIris } from "./podping.js";

const RECONCILE_MS = 60_000;
/** A feed pinged repeatedly (live shows ping often) is refreshed at most this often. */
const PODPING_MIN_REFRESH_MS = 60_000;

export interface RealtimeOptions {
  /** Podping relay; null disables Podping. */
  podpingUrl: string | null;
  reconcileMs?: number;
}

/**
 * Owns every outbound real-time stream. Once a minute it compares the
 * streams it has with the ones the subscriptions call for, opening and
 * closing sockets to match, so new subscriptions need no wiring of their own.
 * Polling stays the source of truth; streams only make updates arrive sooner.
 */
export class RealtimeHub {
  private timer: NodeJS.Timeout | null = null;
  private podping: ReconnectingSocket | null = null;
  private podcastFeeds = new Map<string, string>();
  private lastPodpingRefresh = new Map<string, number>();
  private podpingMatches = 0;

  constructor(
    private readonly storage: Storage,
    private readonly poller: Poller,
    private readonly opts: RealtimeOptions,
  ) {}

  start(): void {
    this.reconcile();
    this.timer = setInterval(() => this.reconcile(), this.opts.reconcileMs ?? RECONCILE_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.podping?.close();
    this.podping = null;
  }

  reconcile(): void {
    this.reconcilePodping();
  }

  status(): { streams: SocketStatus[]; podping: { enabled: boolean; watchedFeeds: number; matches: number } } {
    return {
      streams: [this.podping].filter((s): s is ReconnectingSocket => s !== null).map((s) => ({ ...s.status })),
      podping: { enabled: this.opts.podpingUrl !== null, watchedFeeds: this.podcastFeeds.size, matches: this.podpingMatches },
    };
  }

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
}
