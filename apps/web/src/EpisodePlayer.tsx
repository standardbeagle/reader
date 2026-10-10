import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Article } from "./api";
import { MediaCard } from "./MediaCard";
import { playFrom } from "./playQueue";

function clock(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
}

/**
 * A podcast episode: play and queue it, with Podcasting 2.0 chapters and
 * transcript. Both load only when opened; picking a chapter or a transcript
 * line plays the episode from there in the dock.
 */
export function EpisodePlayer({ a }: { a: Article }) {
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const chapters = useQuery({ queryKey: ["chapters", a.id], queryFn: () => api.getChapters(a.id), enabled: chaptersOpen, staleTime: Infinity });
  const transcript = useQuery({ queryKey: ["transcript", a.id], queryFn: () => api.getTranscript(a.id), enabled: transcriptOpen, staleTime: Infinity });
  const seek = (seconds: number) => playFrom(a, seconds);

  return (
    <section className="episode" aria-label="Episode">
      <MediaCard a={a} />
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
