const MIN = 15;
const MAX = 24 * 60;

export function adaptInterval(current: number, hadNewItems: boolean): number {
  const next = hadNewItems ? Math.floor(current / 2) : current * 2;
  return Math.min(MAX, Math.max(MIN, next));
}

export function backoffMinutes(errorCount: number): number {
  return Math.min(MAX, 2 ** errorCount);
}

/**
 * Never poll faster than the publisher asked (RSS ttl, syndication module,
 * Cache-Control max-age). The ceiling still applies so an absurd hint cannot
 * stop a feed from refreshing at least daily.
 */
export function withPublisherFloor(interval: number, floorMinutes: number | null): number {
  if (floorMinutes === null || !(floorMinutes > 0)) return interval;
  return Math.min(MAX, Math.max(interval, Math.ceil(floorMinutes)));
}

/** Cache-Control max-age in minutes, unless the response forbids caching. */
export function cacheControlMinutes(header: string | null): number | null {
  if (!header || /\b(no-store|no-cache)\b/i.test(header)) return null;
  const match = /\bmax-age=(\d+)/i.exec(header);
  return match ? Number(match[1]) / 60 : null;
}

/** Retry-After as an absolute time: delta-seconds or an HTTP date, capped at a day. */
export function retryAfterTime(header: string | null, now: number): Date | null {
  if (!header) return null;
  const trimmed = header.trim();
  const at = /^\d+$/.test(trimmed) ? now + Number(trimmed) * 1000 : Date.parse(trimmed);
  if (!Number.isFinite(at) || at <= now) return null;
  return new Date(Math.min(at, now + MAX * 60_000));
}
