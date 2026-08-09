import { describe, it, expect } from "vitest";
import { isBlockedAddress, assertPublicUrl, BlockedAddressError } from "../src/net-guard.js";

describe("isBlockedAddress", () => {
  it("blocks loopback, private, link-local and metadata ranges", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.5", "172.16.9.9", "169.254.169.254", "100.64.1.1", "0.0.0.0"]) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
  });

  it("blocks IPv6 loopback, unique-local, link-local and mapped v4", () => {
    for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
  });

  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"]) {
      expect(isBlockedAddress(ip)).toBe(false);
    }
  });

  it("refuses anything that is not an IP literal", () => {
    expect(isBlockedAddress("not-an-ip")).toBe(true);
  });
});

describe("assertPublicUrl (enforced)", () => {
  it("rejects loopback IP literals", async () => {
    await expect(assertPublicUrl("http://127.0.0.1:8080/x", { enforce: true })).rejects.toBeInstanceOf(BlockedAddressError);
  });

  it("rejects the cloud metadata address", async () => {
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data/", { enforce: true })).rejects.toBeInstanceOf(BlockedAddressError);
  });

  it("rejects non-http(s) protocols", async () => {
    await expect(assertPublicUrl("file:///etc/passwd", { enforce: true })).rejects.toBeInstanceOf(BlockedAddressError);
  });

  it("rejects hostnames that resolve to loopback", async () => {
    await expect(assertPublicUrl("http://localhost/x", { enforce: true })).rejects.toBeInstanceOf(BlockedAddressError);
  });

  it("allows a public IP literal", async () => {
    await expect(assertPublicUrl("https://8.8.8.8/", { enforce: true })).resolves.toBeUndefined();
  });
});
