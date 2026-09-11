import { describe, it, expect } from "vitest";
import { parseChapters, parseTranscript } from "../src/transcript.js";

describe("parseTranscript", () => {
  it("reads WebVTT cues with speakers and hour timestamps", () => {
    const vtt = "WEBVTT\n\n1\n00:00:01.500 --> 00:00:04.000\n<v Ann>Hello and welcome.\n\n01:02:03.000 --> 01:02:05.000\nSecond <b>line</b>\n";
    expect(parseTranscript(vtt, "text/vtt")).toEqual({
      kind: "cues",
      cues: [
        { start: 1.5, text: "Hello and welcome.", speaker: "Ann" },
        { start: 3723, text: "Second line", speaker: null },
      ],
    });
  });

  it("reads SRT with comma decimals and CRLF line ends", () => {
    const srt = "1\r\n00:00:02,250 --> 00:00:03,000\r\nFirst\r\nwrapped\r\n\r\n2\r\n00:00:05,000 --> 00:00:06,000\r\nNext\r\n";
    expect(parseTranscript(srt, "application/x-subrip")).toEqual({
      kind: "cues",
      cues: [{ start: 2.25, text: "First wrapped", speaker: null }, { start: 5, text: "Next", speaker: null }],
    });
  });

  it("merges per-word JSON segments into lines per speaker", () => {
    const json = JSON.stringify({ version: "1.0.0", segments: [
      { speaker: "Ann", startTime: 0, endTime: 0.4, body: "Hi" },
      { speaker: "Ann", startTime: 0.4, endTime: 0.8, body: "there" },
      { speaker: "Bob", startTime: 1, endTime: 1.5, body: "Hello" },
      { speaker: "Bob", startTime: 30, endTime: 31, body: "Later" },
    ] });
    expect(parseTranscript(json, "application/json")).toEqual({
      kind: "cues",
      cues: [
        { start: 0, text: "Hi there", speaker: "Ann" },
        { start: 1, text: "Hello", speaker: "Bob" },
        { start: 30, text: "Later", speaker: "Bob" },
      ],
    });
  });

  it("sanitizes HTML and passes plain text through, sniffing mislabeled VTT", () => {
    expect(parseTranscript("<p>Hi</p><script>x()</script>", "text/html")).toEqual({ kind: "html", html: "<p>Hi</p>" });
    expect(parseTranscript("just words", "text/plain")).toEqual({ kind: "text", text: "just words" });
    expect(parseTranscript("WEBVTT\n\n00:01.000 --> 00:02.000\nsniffed", "text/plain")).toMatchObject({ kind: "cues", cues: [{ start: 1, text: "sniffed" }] });
  });
});

describe("parseChapters", () => {
  it("sorts table-of-contents chapters and keeps only http links", () => {
    const json = JSON.stringify({ version: "1.2.0", chapters: [
      { startTime: 90, title: "Second", url: "javascript:alert(1)" },
      { startTime: 0, title: "Intro", img: "https://pod.example.com/intro.jpg" },
      { startTime: 45, title: "Art change", toc: false },
      { startTime: 120 },
    ] });
    expect(parseChapters(json)).toEqual([
      { start: 0, title: "Intro", url: null, img: "https://pod.example.com/intro.jpg" },
      { start: 90, title: "Second", url: null, img: null },
      { start: 120, title: "Untitled chapter", url: null, img: null },
    ]);
  });

  it("rejects a file without chapters", () => {
    expect(() => parseChapters("{}")).toThrow(/chapters array/);
  });
});
