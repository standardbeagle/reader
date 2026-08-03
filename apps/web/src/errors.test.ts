import { describe, it, expect } from "vitest";
import { describeError } from "./errors";

describe("describeError", () => {
  it("returns catalog entries for known codes", () => {
    const info = describeError("feed_fetch_failed");
    expect(info.title).toBe("Couldn't fetch that address");
    expect(info.steps.length).toBeGreaterThan(0);
  });
  it("falls back to unknown for null or unrecognized codes", () => {
    expect(describeError(null).title).toBe("Something went wrong");
    expect(describeError("bogus").title).toBe("Something went wrong");
  });
  it("every catalog entry has title, explanation and at least one step", () => {
    for (const code of ["invalid_url", "duplicate", "feed_fetch_failed", "no_feeds_found", "network", "unknown"]) {
      const info = describeError(code);
      expect(info.title).toBeTruthy();
      expect(info.explanation).toBeTruthy();
      expect(info.steps.length).toBeGreaterThan(0);
    }
  });
});
