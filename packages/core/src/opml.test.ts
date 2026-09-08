import { describe, expect, it } from "vitest";
import { parseOpml } from "./opml.js";

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Subscriptions</title></head>
  <body>
    <outline text="Tech" title="Tech">
      <outline text="Blog A" title="Blog A" type="rss" xmlUrl="https://a.example.com/feed.xml" htmlUrl="https://a.example.com/"/>
      <outline text="Blog B" type="atom" xmlUrl="https://b.example.com/atom.xml"/>
    </outline>
    <outline text="Top level" type="rss" xmlUrl="https://c.example.com/rss" htmlUrl="https://c.example.com/"/>
  </body>
</opml>`;

describe("parseOpml", () => {
  it("collects feeds from nested folders and the top level", async () => {
    const outlines = await parseOpml(SAMPLE);
    expect(outlines.map((o) => o.xmlUrl)).toEqual([
      "https://a.example.com/feed.xml",
      "https://b.example.com/atom.xml",
      "https://c.example.com/rss",
    ]);
    expect(outlines[0]!).toMatchObject({ title: "Blog A", htmlUrl: "https://a.example.com/" });
    expect(outlines[1]!).toMatchObject({ title: "Blog B", htmlUrl: null });
  });

  it("skips folder outlines and duplicate urls", async () => {
    const dupes = `<opml version="1.0"><body>
      <outline text="Folder">
        <outline text="X" xmlUrl="https://x.example.com/feed"/>
      </outline>
      <outline text="X again" xmlUrl="https://x.example.com/feed"/>
    </body></opml>`;
    const outlines = await parseOpml(dupes);
    expect(outlines).toHaveLength(1);
    expect(outlines[0]!.title).toBe("X");
  });

  it("accepts lowercase attribute spellings", async () => {
    const outlines = await parseOpml(`<opml><body>
      <outline text="Lower" xmlurl="https://l.example.com/f" htmlurl="https://l.example.com/"/>
    </body></opml>`);
    expect(outlines[0]!).toMatchObject({ xmlUrl: "https://l.example.com/f", htmlUrl: "https://l.example.com/" });
  });

  it("rejects non-OPML documents", async () => {
    await expect(parseOpml("<html><body>nope</body></html>")).rejects.toThrow(/OPML/);
    await expect(parseOpml("not xml at all")).rejects.toThrow();
  });
});
