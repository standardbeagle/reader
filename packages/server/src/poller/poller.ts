import pLimit from "p-limit";
import { parseFeed, sanitizeHtml } from "@reader/core";
import type { Storage } from "../storage/types.js";
import { adaptInterval, backoffMinutes } from "./interval.js";

export interface RefreshResult {
  newArticles: number;
  notModified?: boolean;
  error?: string;
}

const BROKEN_THRESHOLD = 10;

export class Poller {
  private timer: ReturnType<typeof setInterval> | null = null;
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
    // Error backoff lives here, not in refreshFeed: manual/subscribe refreshes
    // must not be blocked by backoff (a user retry is the reset path).
    const now = Date.now();
    const due = this.storage.dueFeeds(new Date(now)).filter((f) => {
      if (f.errorCount === 0 || !f.lastFetchedAt) return true;
      return now >= new Date(f.lastFetchedAt).getTime() + backoffMinutes(f.errorCount) * 60_000;
    });
    await Promise.all(due.map((f) => this.limit(() => this.refreshFeed(f.id))));
  }

  async refreshFeed(feedId: string): Promise<RefreshResult> {
    const feed = this.storage.getFeed(feedId);
    if (!feed) return { newArticles: 0, error: "feed not found" };
    if (feed.status === "broken") return { newArticles: 0, error: "feed broken" };

    try {
      const res = await fetch(feed.url, {
        headers: {
          ...(feed.etag ? { "if-none-match": feed.etag } : {}),
          ...(feed.lastModified ? { "if-modified-since": feed.lastModified } : {}),
          "user-agent": "reader/0.1 (+local)",
          accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
        },
        signal: AbortSignal.timeout(15_000),
        redirect: "follow",
      });

      if (res.status === 304) {
        this.storage.updateFeedFetchState(feedId, {
          lastFetchedAt: new Date().toISOString(),
          fetchIntervalMin: adaptInterval(feed.fetchIntervalMin, false),
          errorCount: 0, status: "ok",
        });
        return { newArticles: 0, notModified: true };
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const xml = await res.text();
      const parsed = await parseFeed(xml);
      const inserted = this.storage.upsertArticles(feedId, parsed.articles, sanitizeHtml);

      this.storage.updateFeedFetchState(feedId, {
        etag: res.headers.get("etag"),
        lastModified: res.headers.get("last-modified"),
        lastFetchedAt: new Date().toISOString(),
        fetchIntervalMin: adaptInterval(feed.fetchIntervalMin, inserted.length > 0),
        errorCount: 0, status: "ok",
        title: parsed.title,
        siteUrl: parsed.siteUrl,
      });
      return { newArticles: inserted.length };
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
  }
}
