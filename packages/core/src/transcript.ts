import { sanitizeHtml } from "./sanitize.js";

/** One timed line; `start` is seconds into the episode. */
export interface TranscriptCue {
  start: number;
  text: string;
  speaker: string | null;
}

export type Transcript =
  | { kind: "cues"; cues: TranscriptCue[] }
  | { kind: "html"; html: string }
  | { kind: "text"; text: string };

export interface Chapter {
  start: number;
  title: string;
  url: string | null;
  img: string | null;
}

const MAX_CUES = 20_000;
const MAX_CHAPTERS = 500;
// Podcast Index JSON transcripts are often one segment per word; merge a
// speaker's consecutive segments into readable lines of about this length.
const MERGE_SECONDS = 20;

/** "01:02:03.500", "02:03,5" or "3.5" → seconds. */
function timestamp(raw: string): number | null {
  const parts = raw.trim().replace(",", ".").split(":");
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  return parts.reduce((total, p) => total * 60 + Number(p), 0);
}

/** WebVTT and SRT share a shape: optional id line, "start --> end", text lines, blank line. */
function parseTimedText(body: string): TranscriptCue[] {
  const cues: TranscriptCue[] = [];
  for (const block of body.replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
    const lines = block.split("\n");
    const timingIndex = lines.findIndex((l) => l.includes("-->"));
    if (timingIndex === -1) continue;
    const start = timestamp(lines[timingIndex]!.split("-->")[0]!);
    if (start === null) continue;
    const raw = lines.slice(timingIndex + 1).join(" ").trim();
    const speaker = /<v(?:\.[^\s>]+)?\s+([^>]+)>/.exec(raw)?.[1]?.trim() ?? null;
    const text = raw.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (text) cues.push({ start, text, speaker });
    if (cues.length >= MAX_CUES) break;
  }
  return cues;
}

function parseJsonTranscript(body: string): TranscriptCue[] {
  const doc = JSON.parse(body) as { segments?: unknown };
  if (!Array.isArray(doc.segments)) throw new Error("JSON transcript has no segments");
  const cues: TranscriptCue[] = [];
  for (const raw of doc.segments as Record<string, unknown>[]) {
    const start = typeof raw?.startTime === "number" ? raw.startTime : null;
    const text = typeof raw?.body === "string" ? raw.body.trim() : "";
    if (start === null || !text) continue;
    const speaker = typeof raw.speaker === "string" && raw.speaker.trim() ? raw.speaker.trim() : null;
    const last = cues[cues.length - 1];
    if (last && last.speaker === speaker && start - last.start < MERGE_SECONDS) {
      last.text = `${last.text} ${text}`;
    } else {
      cues.push({ start, text, speaker });
      if (cues.length >= MAX_CUES) break;
    }
  }
  return cues;
}

/**
 * Normalize a Podcasting 2.0 transcript. Timed formats (WebVTT, SRT, JSON)
 * become cues the player can seek to; HTML is sanitized; anything else is
 * plain text. The declared type decides, with a WEBVTT header sniff for
 * servers that send text/plain.
 */
export function parseTranscript(body: string, type: string | null): Transcript {
  const t = (type ?? "").toLowerCase();
  const trimmed = body.replace(/^\uFEFF/, "").trimStart();
  if (t === "application/json" || (!t && trimmed.startsWith("{"))) {
    return { kind: "cues", cues: parseJsonTranscript(trimmed) };
  }
  if (t === "text/vtt" || t === "application/x-subrip" || t === "application/srt" || trimmed.startsWith("WEBVTT")) {
    return { kind: "cues", cues: parseTimedText(trimmed) };
  }
  if (t === "text/html") return { kind: "html", html: sanitizeHtml(trimmed) };
  return { kind: "text", text: trimmed };
}

function httpUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Podcasting 2.0 JSON chapters: `{ chapters: [{ startTime, title, url?, img?, toc? }] }`. */
export function parseChapters(body: string): Chapter[] {
  const doc = JSON.parse(body) as { chapters?: unknown };
  if (!Array.isArray(doc.chapters)) throw new Error("chapters file has no chapters array");
  return (doc.chapters as Record<string, unknown>[])
    // toc: false marks silent chapters (art changes) that are not table-of-contents entries.
    .filter((c) => typeof c?.startTime === "number" && c.toc !== false)
    .map((c) => ({
      start: c.startTime as number,
      title: typeof c.title === "string" && c.title.trim() ? c.title.trim() : "Untitled chapter",
      url: httpUrl(c.url),
      img: httpUrl(c.img),
    }))
    .sort((a, b) => a.start - b.start)
    .slice(0, MAX_CHAPTERS);
}
