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

  it("adds loading=lazy and referrerpolicy=no-referrer to images", () => {
    const out = sanitizeHtml('<img src="https://x.com/a.png">');
    expect(out).toContain('loading="lazy"');
    expect(out).toContain('referrerpolicy="no-referrer"');
  });

  it("keeps safe media and formula markup while sandboxing embeds", () => {
    const out = sanitizeHtml(
      '<figure><img src="/cover.jpg"><figcaption>cover</figcaption></figure>' +
      '<video src="/movie.mp4"></video><audio src="/sound.mp3"></audio>' +
      '<iframe src="https://player.example/embed/1"></iframe>' +
      '<math><mrow><mi>x</mi><mo>=</mo><mn>1</mn></mrow></math>',
      "https://example.com/posts/one",
    );
    expect(out).toContain('src="https://example.com/cover.jpg"');
    expect(out).toContain('src="https://example.com/movie.mp4"');
    expect(out).toContain('controls=""');
    expect(out).toContain('sandbox="allow-forms allow-modals allow-popups allow-presentation allow-scripts"');
    expect(out).toContain("<math>");
    expect(out).toContain("<mi>x</mi>");
  });

  it("excludes dangerous tags and unsafe media URLs", () => {
    const out = sanitizeHtml(
      '<style>body{display:none}</style><iframe src="javascript:alert(1)"></iframe><form><input></form><svg><script>alert(1)</script></svg>'
    );
    expect(out).not.toContain("<style");
    expect(out).not.toContain("<iframe");
    expect(out).not.toContain("<form");
    expect(out).not.toContain("<svg");
    expect(out).not.toContain("<script");
  });

  it("strips inline style attributes so feed CSS cannot track or overlay", () => {
    const out = sanitizeHtml('<p style="position:fixed;inset:0;background:url(https://tracker/x.png)">hi</p>');
    expect(out).not.toContain("style");
    expect(out).not.toContain("tracker");
    expect(out).toBe("<p>hi</p>");
  });

  it("strips feed-supplied allow attributes from iframes", () => {
    const out = sanitizeHtml('<iframe src="https://player.example/embed/1" allow="camera; microphone"></iframe>');
    expect(out).toContain("<iframe");
    expect(out).not.toContain("camera");
    expect(out).not.toContain("microphone");
  });

  it("turns supported custom video embeds into sandboxed iframes", () => {
    const out = sanitizeHtml('<lite-youtube videoid="dQw4w9WgXcQ" title="Demo"></lite-youtube>');
    expect(out).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"');
    expect(out).toContain('title="Demo"');
    expect(out).toContain('referrerpolicy="strict-origin-when-cross-origin"');
    expect(out).toContain('sandbox="allow-same-origin allow-forms allow-modals allow-popups allow-presentation allow-scripts"');
  });
});
