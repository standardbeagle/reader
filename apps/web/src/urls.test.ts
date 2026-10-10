import { describe, expect, it } from "vitest";
import { embeddedPageSandbox, idFromRouteKey, routeKey, slugify } from "./urls";

describe("readable route keys", () => {
  it("slugifies feed and article titles", () => {
    expect(slugify("Simon Willison's Weblog")).toBe("simon-willison-s-weblog");
    expect(slugify("A title: C++ & déjà vu")).toBe("a-title-c-and-deja-vu");
  });

  it("retains the stable id and supports legacy id-only routes", () => {
    const id = "2b452077-4a8b-4f20-9583-0001d97303f9";
    expect(idFromRouteKey(routeKey("Now we have a timeline", id))).toBe(id);
    expect(idFromRouteKey(id)).toBe(id);
  });
});

describe("embedded page sandbox", () => {
  const reader = "https://reader.example.com";

  it("lets another site's page keep its origin, so its module scripts and storage work", () => {
    expect(embeddedPageSandbox("https://blog.example.org/posts/one/", reader).split(" ")).toContain("allow-same-origin");
    // Same site is not same origin: a sibling host or another port is still someone else's page.
    expect(embeddedPageSandbox("https://other.example.com/", reader)).toContain("allow-same-origin");
    expect(embeddedPageSandbox("https://reader.example.com:8443/", reader)).toContain("allow-same-origin");
  });

  it("never gives Reader's own origin to a framed page", () => {
    for (const url of ["https://reader.example.com/", "https://READER.example.com:443/api/v1/feeds", "https://reader.example.com/lists/x.xml"]) {
      expect(embeddedPageSandbox(url, reader), url).not.toContain("allow-same-origin");
    }
  });
});
