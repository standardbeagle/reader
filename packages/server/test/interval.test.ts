import { describe, it, expect } from "vitest";
import { adaptInterval, backoffMinutes } from "../src/poller/interval.js";

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
