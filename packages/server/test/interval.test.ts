import { describe, it, expect } from "vitest";
import { adaptInterval, backoffMinutes, cacheControlMinutes, retryAfterTime, withPublisherFloor } from "../src/poller/interval.js";

describe("adaptInterval", () => {
  it("halves on new items, clamped to 15", () => {
    expect(adaptInterval(60, true)).toBe(30);
    expect(adaptInterval(15, true)).toBe(15);
  });
  it("doubles on empty, clamped to 1440", () => {
    expect(adaptInterval(60, false)).toBe(120);
    expect(adaptInterval(1000, false)).toBe(1440);
  });
});

describe("backoffMinutes", () => {
  it("is 2^errorCount clamped to 1440", () => {
    expect(backoffMinutes(0)).toBe(1);
    expect(backoffMinutes(3)).toBe(8);
    expect(backoffMinutes(20)).toBe(1440);
  });
});

describe("publisher hints", () => {
  it("floors the interval at the publisher's hint, still capped at a day", () => {
    expect(withPublisherFloor(30, null)).toBe(30);
    expect(withPublisherFloor(30, 180)).toBe(180);
    expect(withPublisherFloor(240, 180)).toBe(240);
    expect(withPublisherFloor(30, 525_600)).toBe(1440);
  });
  it("reads Cache-Control max-age unless caching is forbidden", () => {
    expect(cacheControlMinutes("public, max-age=3600")).toBe(60);
    expect(cacheControlMinutes("no-cache, max-age=3600")).toBeNull();
    expect(cacheControlMinutes(null)).toBeNull();
  });
  it("turns Retry-After seconds or dates into a time, capped at a day", () => {
    const now = Date.parse("2026-09-10T12:00:00Z");
    expect(retryAfterTime("120", now)?.toISOString()).toBe("2026-09-10T12:02:00.000Z");
    expect(retryAfterTime("Thu, 10 Sep 2026 13:00:00 GMT", now)?.toISOString()).toBe("2026-09-10T13:00:00.000Z");
    expect(retryAfterTime("999999", now)?.toISOString()).toBe("2026-09-11T12:00:00.000Z");
    expect(retryAfterTime("yesterday", now)).toBeNull();
  });
});
