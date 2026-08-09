import { describe, it, expect } from "vitest";
import { stripInternalKeys } from "../src/api/routes-ingestors.js";

describe("stripInternalKeys", () => {
  it("removes underscore-prefixed override keys", () => {
    const out = stripInternalKeys({
      subreddit: "tech",
      clientId: "cid",
      clientSecret: "sec",
      _baseUrl: "http://attacker",
      _tokenBase: "http://attacker",
      _oauthBase: "http://attacker",
      _cacheKey: "x",
      _kind: "test",
    });
    expect(out).toEqual({ subreddit: "tech", clientId: "cid", clientSecret: "sec" });
  });

  it("leaves configs without override keys untouched", () => {
    const config = { handle: "bob.bsky.social", identifier: "me", appPassword: "pw" };
    expect(stripInternalKeys(config)).toEqual(config);
  });
});
