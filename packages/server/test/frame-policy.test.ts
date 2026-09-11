import { describe, it, expect } from "vitest";
import { frameBlockReason } from "../src/frame-policy.js";

const h = (init: Record<string, string>) => new Headers(init);

describe("frameBlockReason", () => {
  it("allows pages without framing headers", () => {
    expect(frameBlockReason(h({}))).toBeNull();
    expect(frameBlockReason(h({ "content-security-policy": "default-src 'self'" }))).toBeNull();
  });

  it("blocks on X-Frame-Options DENY or SAMEORIGIN and ignores values browsers ignore", () => {
    expect(frameBlockReason(h({ "x-frame-options": "SAMEORIGIN" }))).toMatch(/SAMEORIGIN/);
    expect(frameBlockReason(h({ "x-frame-options": "deny" }))).toMatch(/DENY/);
    expect(frameBlockReason(h({ "x-frame-options": "ALLOW-FROM https://reader.example" }))).toBeNull();
  });

  it("lets frame-ancestors decide alone when present", () => {
    expect(frameBlockReason(h({ "content-security-policy": "frame-ancestors 'none'" }))).toMatch(/'none'/);
    expect(frameBlockReason(h({ "content-security-policy": "default-src 'self'; frame-ancestors https://*.theverge.com 'self'" }))).toMatch(/own sites/);
    // A wildcard frame-ancestors overrides a blocking X-Frame-Options, as in browsers.
    expect(frameBlockReason(h({ "content-security-policy": "frame-ancestors *", "x-frame-options": "DENY" }))).toBeNull();
  });

  it("enforces every CSP policy when several are sent", () => {
    expect(frameBlockReason(h({ "content-security-policy": "frame-ancestors *, frame-ancestors 'self'" }))).toMatch(/own sites/);
  });
});
