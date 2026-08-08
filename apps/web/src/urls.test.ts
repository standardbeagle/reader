import { describe, expect, it } from "vitest";
import { idFromRouteKey, routeKey, slugify } from "./urls";

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
