import { describe, expect, it } from "vitest";
import { DEFAULT_PLAYER_PREFS, parsePlayerPrefs } from "./playerPrefs";

describe("player prefs", () => {
  it("reads back what was stored", () => {
    const stored = { rate: 1.75, volume: 0.4, muted: true, largeVideo: true };
    expect(parsePlayerPrefs(JSON.stringify(stored))).toEqual(stored);
  });

  it("defaults whatever is missing, malformed or out of range, one field at a time", () => {
    expect(parsePlayerPrefs(null)).toEqual(DEFAULT_PLAYER_PREFS);
    expect(parsePlayerPrefs("{not json")).toEqual(DEFAULT_PLAYER_PREFS);
    expect(parsePlayerPrefs("[1.5]")).toEqual(DEFAULT_PLAYER_PREFS);
    expect(parsePlayerPrefs(JSON.stringify({ rate: 0, volume: 1.5, muted: "yes", largeVideo: true })))
      .toEqual({ ...DEFAULT_PLAYER_PREFS, largeVideo: true });
    expect(parsePlayerPrefs(JSON.stringify({ rate: 2 }))).toEqual({ ...DEFAULT_PLAYER_PREFS, rate: 2 });
  });
});
