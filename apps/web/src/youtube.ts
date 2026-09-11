/** A YouTube video a link points at, and whether it is a vertical Short. */
export interface YoutubeVideo {
  id: string;
  short: boolean;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Recognize watch, youtu.be, Shorts and live links. YouTube refuses to let
 * its watch pages be framed, but its /embed player is made for it.
 */
export function youtubeVideo(raw: string | null | undefined): YoutubeVideo | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  let id: string | null = null;
  let short = false;
  if (host === "youtu.be") id = url.pathname.slice(1);
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const [, first, second] = url.pathname.split("/");
    if (first === "watch") id = url.searchParams.get("v");
    else if (first === "shorts" || first === "live" || first === "embed") { id = second ?? null; short = first === "shorts"; }
  }
  return id && VIDEO_ID.test(id) ? { id, short } : null;
}

/** The privacy-enhanced embed player (no cookies until the viewer presses play). */
export function youtubeEmbedUrl(video: YoutubeVideo): string {
  return `https://www.youtube-nocookie.com/embed/${video.id}?rel=0`;
}
