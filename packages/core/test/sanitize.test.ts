import { describe, it, expect } from "vitest";
import { sanitizeHtml } from "../src/sanitize.js";

describe("sanitizeHtml", () => {
  it("strips script tags and event handlers", () => {
    const out = sanitizeHtml('<p onclick="x()">hi</p><script>alert(1)</script>');
    expect(out).toBe("<p>hi</p>");
  });

  it("strips javascript: URLs", () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain("javascript:");
  });

  it("keeps safe article markup", () => {
    const input = '<h2>T</h2><p>para <b>bold</b> <a href="https://x.com">l</a></p><img src="https://x.com/a.png" alt="a">';
    const out = sanitizeHtml(input);
    expect(out).toContain("<h2>");
    expect(out).toContain('href="https://x.com"');
    expect(out).toContain('src="https://x.com/a.png"');
  });

  it("forces external links to rel=noopener and target=_blank", () => {
    const out = sanitizeHtml('<a href="https://x.com">l</a>');
    expect(out).toContain('rel="noopener');
    expect(out).toContain('target="_blank"');
  });
});
