import pLimit from "p-limit";
import { parseFeed, sanitizeHtml } from "@reader/core";
import type { Storage } from "../storage/types.js";
import { adaptInterval, backoffMinutes } from "./interval.js";

import { fetchCapped } from "../fetch.js";

export { MAX_FEED_BYTES } from "../fetch.js";

export interface RefreshResult {
  newArticles: number;
  notModified?: boolean;
  error?: string;
}

const BROKEN_THRESHOLD = 10;

export class Poller {
  private timer: ReturnType<typeof setInterval> | null = null;
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
    this.tick().catch((e) => console.error("[poller] tick error", e));
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      // Error backoff lives here, not in refreshFeed: manual/subscribe refreshes
      // must not be blocked by backoff (a user retry is the reset path).
      const now = Date.now();
      const due = this.storage.dueFeeds(new Date(now)).filter((f) => {
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
    if (feed.status === "broken") return { newArticles: 0, error: "feed broken" };

    let parsed: Awaited<ReturnType<typeof parseFeed>> | null = null;
    let etag: string | null = null;
    let lastModified: string | null = null;
    let notModified = false;
    try {
      const res = await fetchCapped(feed.url, {
        headers: {
          ...(feed.etag ? { "if-none-match": feed.etag } : {}),
          ...(feed.lastModified ? { "if-modified-since": feed.lastModified } : {}),
        },
      });

      if (res.status === 304) {
        notModified = true;
      } else {
        if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
        etag = res.headers.get("etag");
        lastModified = res.headers.get("last-modified");
        parsed = await parseFeed(res.body);
      }
    } catch (e) {
      const errorCount = feed.errorCount + 1;
      this.storage.updateFeedFetchState(feedId, {
        lastFetchedAt: new Date().toISOString(),
        fetchIntervalMin: feed.fetchIntervalMin,
        errorCount,
        status: errorCount >= BROKEN_THRESHOLD ? "broken" : "ok",
      });
      return { newArticles: 0, error: e instanceof Error ? e.message : String(e) };
    }

    if (notModified) {
      this.storage.updateFeedFetchState(feedId, {
        lastFetchedAt: new Date().toISOString(),
        fetchIntervalMin: adaptInterval(feed.fetchIntervalMin, false),
        errorCount: 0, status: "ok",
      });
      return { newArticles: 0, notModified: true };
    }
    const inserted = this.storage.upsertArticles(feedId, parsed!.articles, sanitizeHtml);
    this.storage.updateFeedFetchState(feedId, {
      etag,
      lastModified,
      lastFetchedAt: new Date().toISOString(),
      fetchIntervalMin: adaptInterval(feed.fetchIntervalMin, inserted.length > 0),
      errorCount: 0, status: "ok",
      title: parsed!.title,
      siteUrl: parsed!.siteUrl,
    });
    return { newArticles: inserted.length };
  }
}
