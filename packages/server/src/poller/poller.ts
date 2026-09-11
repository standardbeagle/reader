import pLimit from "p-limit";
import { parseFeed, sanitizeHtml } from "@reader/core";
import type { Storage } from "../storage/types.js";
import { adaptInterval, backoffMinutes, cacheControlMinutes, retryAfterTime, withPublisherFloor } from "./interval.js";

import { fetchCapped } from "../fetch.js";
import { authorizationFor } from "../auth/credentials.js";

export { MAX_FEED_BYTES } from "../fetch.js";

export interface RefreshResult {
  newArticles: number;
  notModified?: boolean;
  error?: string;
}

const BROKEN_THRESHOLD = 10;
const STARTUP_DELAY_MS = 5_000;

export class Poller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private ticking = false;
  private readonly tickMs: number;
  private readonly limit: ReturnType<typeof pLimit>;

  constructor(
    private readonly storage: Storage,
    opts: { tickMs?: number; concurrency?: number } = {},
  ) {
    this.tickMs = opts.tickMs ?? 60_000;
    this.limit = pLimit(opts.concurrency ?? 8);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((e) => console.error("[poller] tick error", e));
    }, this.tickMs);
    this.timer.unref?.();
    // Let health, feed-list, and article-list requests get through before a
    // restart-triggered refresh begins parsing and writing all due feeds.
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null;
      this.tick().catch((e) => console.error("[poller] tick error", e));
    }, Math.min(STARTUP_DELAY_MS, this.tickMs));
    this.startupTimer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.timer = null;
    this.startupTimer = null;
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      // Error backoff lives here, not in refreshFeed: manual/subscribe refreshes
      // must not be blocked by backoff (a user retry is the reset path).
      const now = Date.now();
      const due = this.storage.dueFeeds(new Date(now)).filter((f) => {
        if (f.retryAfter && now < Date.parse(f.retryAfter)) return false;
        if (f.status === "broken") return true;
        if (f.errorCount === 0 || !f.lastFetchedAt) return true;
        return now >= new Date(f.lastFetchedAt).getTime() + backoffMinutes(f.errorCount) * 60_000;
      });
      await Promise.all(due.map((f) => this.limit(() => this.refreshFeed(f.id))));
    } finally {
      this.ticking = false;
    }
  }

  async refreshFeed(feedId: string): Promise<RefreshResult> {
    const feed = this.storage.getFeed(feedId);
    if (!feed) return { newArticles: 0, error: "feed not found" };

    let parsed: Awaited<ReturnType<typeof parseFeed>> | null = null;
    let etag: string | null = null;
    let lastModified: string | null = null;
    let notModified = false;
    let retryAfter: Date | null = null;
    let cacheFloor: number | null = null;
    try {
      const fetchFeed = async (forceRefresh: boolean) => fetchCapped(feed.url, {
        headers: {
          ...(feed.etag ? { "if-none-match": feed.etag } : {}),
          ...(feed.lastModified ? { "if-modified-since": feed.lastModified } : {}),
          ...(feed.credentialId
            ? { authorization: await authorizationFor(this.storage, feed.credentialId, feed.url, { forceRefresh }) }
            : {}),
        },
      });
      let res = await fetchFeed(false);
      // An OAuth token can be revoked or expire early; refresh once before failing.
      if (res.status === 401 && feed.credentialId && this.storage.getCredential(feed.credentialId)?.secret.kind === "oauth2") {
        res = await fetchFeed(true);
      }

      cacheFloor = cacheControlMinutes(res.headers.get("cache-control"));
      if (res.status === 304) {
        notModified = true;
      } else {
        if (res.status === 429 || res.status === 503) {
          retryAfter = retryAfterTime(res.headers.get("retry-after"), Date.now());
          throw new Error(`HTTP ${res.status}${retryAfter ? ` (retry after ${retryAfter.toISOString()})` : ""}`);
        }
        if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
        etag = res.headers.get("etag");
        lastModified = res.headers.get("last-modified");
        parsed = await parseFeed(res.body);
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      const errorCount = feed.errorCount + 1;
      this.storage.updateFeedFetchState(feedId, {
        lastFetchedAt: new Date().toISOString(),
        lastError: error,
        fetchIntervalMin: feed.fetchIntervalMin,
        errorCount,
        status: errorCount >= BROKEN_THRESHOLD ? "broken" : "ok",
        retryAfter: retryAfter?.toISOString() ?? null,
      });
      return { newArticles: 0, error };
    }

    if (notModified) {
      this.storage.updateFeedFetchState(feedId, {
        lastFetchedAt: new Date().toISOString(),
        lastError: null,
        fetchIntervalMin: withPublisherFloor(adaptInterval(feed.fetchIntervalMin, false), cacheFloor),
        errorCount: 0, status: "ok",
      });
      return { newArticles: 0, notModified: true };
    }
    const inserted = this.storage.upsertArticles(
      feedId,
      parsed!.articles,
      sanitizeHtml,
      parsed!.siteUrl ?? feed.siteUrl ?? feed.url,
    );
    this.storage.updateFeedFetchState(feedId, {
      etag,
      lastModified,
      lastFetchedAt: new Date().toISOString(),
      lastError: null,
      fetchIntervalMin: withPublisherFloor(
        adaptInterval(feed.fetchIntervalMin, inserted.length > 0),
        Math.max(parsed!.updateHintMinutes ?? 0, cacheFloor ?? 0) || null,
      ),
      errorCount: 0, status: "ok",
      title: parsed!.title,
      siteUrl: parsed!.siteUrl,
    });
    return { newArticles: inserted.length };
  }
}
