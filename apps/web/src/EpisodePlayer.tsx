import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Article } from "./api";
import { safeUrl } from "./urls";

function clock(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
}

/**
 * A podcast episode's audio or video, with Podcasting 2.0 chapters and
 * transcript. Both load only when opened; picking a chapter or a transcript
 * line seeks the player there.
 */
export function EpisodePlayer({ a }: { a: Article }) {
  const player = useRef<HTMLMediaElement | null>(null);
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const chapters = useQuery({ queryKey: ["chapters", a.id], queryFn: () => api.getChapters(a.id), enabled: chaptersOpen, staleTime: Infinity });
  const transcript = useQuery({ queryKey: ["transcript", a.id], queryFn: () => api.getTranscript(a.id), enabled: transcriptOpen, staleTime: Infinity });
  const src = safeUrl(a.media?.url ?? null);
  if (!src) return null;
  const isVideo = a.media?.type?.startsWith("video/") ?? /\.(mp4|m4v|mov|webm)(\?|$)/i.test(src);
  const seek = (seconds: number) => {
    if (!player.current) return;
    player.current.currentTime = seconds;
    void player.current.play().catch(() => { /* autoplay refused; the position is still set */ });
  };

  return (
    <section className="episode" aria-label="Episode">
      {isVideo
        ? <video ref={(el) => { player.current = el; }} className="episode-player" src={src} controls preload="metadata" playsInline />
        : <audio ref={(el) => { player.current = el; }} className="episode-player" src={src} controls preload="metadata" />}
      {a.chaptersUrl && (
        <details className="episode-extra" onToggle={(e) => setChaptersOpen((e.target as HTMLDetailsElement).open)}>
          <summary>Chapters</summary>
          {chapters.isPending && <p className="episode-note">Loading chapters…</p>}
          {chapters.isError && <p className="episode-note">Couldn't load the chapters.</p>}
          <ol className="episode-chapters">
            {(chapters.data ?? []).map((c) => (
              <li key={`${c.start}-${c.title}`}>
                <button type="button" onClick={() => seek(c.start)}>
                  <span className="episode-time">{clock(c.start)}</span> {c.title}
                </button>
              </li>
            ))}
          </ol>
        </details>
      )}
      {a.transcript && (
        <details className="episode-extra" onToggle={(e) => setTranscriptOpen((e.target as HTMLDetailsElement).open)}>
          <summary>Transcript</summary>
          {transcript.isPending && <p className="episode-note">Loading transcript…</p>}
          {transcript.isError && <p className="episode-note">Couldn't load the transcript.</p>}
          {transcript.data?.kind === "cues" && (
            <ol className="episode-transcript">
              {transcript.data.cues.map((cue, i) => (
                <li key={i}>
                  <button type="button" onClick={() => seek(cue.start)}>
                    <span className="episode-time">{clock(cue.start)}</span>
                    {cue.speaker && <strong> {cue.speaker}:</strong>} {cue.text}
                  </button>
                </li>
              ))}
            </ol>
          )}
          {/* Sanitized server-side by the same sanitizer as article bodies. */}
          {transcript.data?.kind === "html" && <div className="article-content" dangerouslySetInnerHTML={{ __html: transcript.data.html }} />}
          {transcript.data?.kind === "text" && <p className="feed-plain-text">{transcript.data.text}</p>}
        </details>
      )}
    </section>
  );
}
