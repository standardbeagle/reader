import { describe, expect, it } from "vitest";
import { parseYoutubeTakeout, youtubeChannelFeedUrl } from "./youtube-takeout.js";

const A = "UCaaaaaaaaaaaaaaaaaaaaaa";
const B = "UCbbbbbbbbbbbbbbbbbbbb-_";

describe("parseYoutubeTakeout", () => {
  it("maps each channel row to its RSS feed", () => {
    const csv = `Channel Id,Channel Url,Channel Title\r\n${A},http://www.youtube.com/channel/${A},Alpha\r\n${B},http://www.youtube.com/channel/${B},Beta\r\n\r\n`;
    expect(parseYoutubeTakeout(csv)).toEqual([
      { title: "Alpha", xmlUrl: youtubeChannelFeedUrl(A), htmlUrl: `https://www.youtube.com/channel/${A}` },
      { title: "Beta", xmlUrl: youtubeChannelFeedUrl(B), htmlUrl: `https://www.youtube.com/channel/${B}` },
    ]);
    expect(youtubeChannelFeedUrl(A)).toBe(`https://www.youtube.com/feeds/videos.xml?channel_id=${A}`);
  });

  it("handles quoted titles, a BOM, a localized header and duplicates", () => {
    const csv = `\uFEFFID de la chaîne,URL de la chaîne,Titre\n${A},x,"Alpha, ""the"" first"\n${A},x,Again\n`;
    const outlines = parseYoutubeTakeout(csv);
    expect(outlines).toHaveLength(1);
    expect(outlines[0]!.title).toBe(`Alpha, "the" first`);
  });

  it("accepts a file without a header and falls back to the id for a blank title", () => {
    expect(parseYoutubeTakeout(`\uFEFF${A},x,\n`)[0]!.title).toBe(A);
  });

  it("rejects rows that are not channel ids", () => {
    expect(() => parseYoutubeTakeout(`Channel Id,Channel Url,Channel Title\n${A},x,Alpha\nnot-an-id,x,Bad\n`))
      .toThrow(/line 3/);
    expect(() => parseYoutubeTakeout(`name,email\nbob,bob@example.com\n`)).toThrow(/line 2/);
  });

  it("rejects an unterminated quote", () => {
    expect(() => parseYoutubeTakeout(`${A},x,"Alpha\n`)).toThrow(/quote/);
  });
});
