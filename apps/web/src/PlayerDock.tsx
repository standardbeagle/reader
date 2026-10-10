import { useEffect, useRef, useState } from "react";
import {
  currentItem, jumpTo, playRequestCount, registerSeek, removeAt, savePosition, step, updateQueue, usePlayQueue,
  EMPTY_QUEUE, type QueueItem,
} from "./playQueue";
import { safeUrl } from "./urls";
import { youtubeVideo } from "./youtube";

const YOUTUBE_ORIGIN = "https://www.youtube-nocookie.com";
const YOUTUBE_ENDED = 0;
const SAVE_EVERY_S = 5;

/** Remember playback progress, but not on every tick of the player. */
function useProgressSaver(itemId: string | undefined) {
  const saved = useRef(0);
  useEffect(() => { saved.current = 0; }, [itemId]);
  return (seconds: number) => {
    if (!itemId || Math.abs(seconds - saved.current) < SAVE_EVERY_S) return;
    saved.current = seconds;
    savePosition(itemId, seconds);
  };
}

/**
 * The app's one media player and its queue. It sits outside the three
 * columns so audio and video keep playing while the reader moves between
 * feeds and articles; when an item ends the next one in the queue starts.
 */
export function PlayerDock(props: {
  /** Show the article an item came from. */
  onOpen: (item: QueueItem) => void;
  /** An item played to its end. */
  onPlayed: (item: QueueItem) => void;
}) {
  const queue = usePlayQueue();
  const requests = playRequestCount();
  const item = currentItem(queue);
  const [queueOpen, setQueueOpen] = useState(false);
  const [large, setLarge] = useState(false);
  const media = useRef<HTMLMediaElement | null>(null);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const saveProgress = useProgressSaver(item?.id);
  const { onPlayed } = props;

  const src = safeUrl(item?.media?.url ?? null);
  const video = item && !src ? youtubeVideo(item.url) : null;
  const isVideo = Boolean(video) || Boolean(src && (item?.media?.type?.startsWith("video/") ?? /\.(mp4|m4v|mov|webm)(\?|$)/i.test(src)));

  const finished = () => {
    if (!item) return;
    onPlayed(item);
    updateQueue((q) => step(q, 1));
  };
  // Handlers below are bound once per item; they must see the latest closure.
  const onFinished = useRef(finished);
  onFinished.current = finished;

  // Start (or restart) the native player whenever playback is asked for. On
  // a fresh page load nothing has been asked for yet: the item is restored
  // at its saved position and waits for the user.
  useEffect(() => {
    const el = media.current;
    if (!el || !src) return;
    const start = () => { if (queue.position > 0) el.currentTime = queue.position; };
    if (el.readyState >= 1) start();
    else el.addEventListener("loadedmetadata", start, { once: true });
    if (requests > 0) void el.play().catch(() => { /* autoplay refused; the controls are right there */ });
    return () => el.removeEventListener("loadedmetadata", start);
    // queue.position is read when playback is requested, not tracked: it also changes as the item plays.
  }, [src, requests]);

  useEffect(() => {
    registerSeek((seconds) => {
      if (media.current) {
        media.current.currentTime = seconds;
        void media.current.play().catch(() => {});
      } else {
        frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "seekTo", args: [seconds, true] }), YOUTUBE_ORIGIN);
      }
    });
    return () => registerSeek(null);
  }, []);

  // YouTube's embed reports its state over postMessage once it is told
  // someone is listening; that is the only way to learn a video has ended.
  useEffect(() => {
    if (!video) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== YOUTUBE_ORIGIN || event.source !== frame.current?.contentWindow || typeof event.data !== "string") return;
      let message: { event?: string; info?: unknown };
      try { message = JSON.parse(event.data) as typeof message; } catch { return; }
      const info = message.info as { playerState?: number; currentTime?: number } | number | null | undefined;
      const state = typeof info === "number" ? info : info?.playerState;
      if (typeof info === "object" && info && typeof info.currentTime === "number") saveProgress(info.currentTime);
      if ((message.event === "onStateChange" || message.event === "infoDelivery") && state === YOUTUBE_ENDED) onFinished.current();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [video?.id, requests]);

  if (!item) return null;

  const listen = () => {
    const target = frame.current?.contentWindow;
    target?.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), YOUTUBE_ORIGIN);
    target?.postMessage(JSON.stringify({ event: "command", func: "addEventListener", args: ["onStateChange"], id: 1, channel: "widget" }), YOUTUBE_ORIGIN);
  };
  const youtubeSrc = video && `${YOUTUBE_ORIGIN}/embed/${video.id}?${new URLSearchParams({
    rel: "0", enablejsapi: "1", origin: window.location.origin,
    autoplay: requests > 0 ? "1" : "0", start: String(Math.floor(queue.position)),
  })}`;
  const hasPrev = queue.index > 0;
  const hasNext = queue.index < queue.items.length - 1;

  return (
    <footer className={`player-dock${isVideo ? " has-video" : ""}`} aria-label="Player">
      {isVideo && (
        <div className={`player-video${large ? " large" : ""}${video?.short ? " short" : ""}`}>
          {youtubeSrc ? (
            <iframe
              // A new request for the same video reloads the frame, which is how an embed restarts.
              key={`${video!.id}:${requests}`}
              ref={frame}
              src={youtubeSrc}
              title={`YouTube video: ${item.title}`}
              onLoad={listen}
              // YouTube's embed refuses to play without the embedding page's origin as referrer.
              referrerPolicy="strict-origin-when-cross-origin"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
              allowFullScreen
            />
          ) : (
            <video
              ref={(el) => { media.current = el; }}
              src={src!}
              controls
              playsInline
              preload="metadata"
              onTimeUpdate={(e) => saveProgress(e.currentTarget.currentTime)}
              onEnded={finished}
            />
          )}
          <button type="button" className="player-video-size" onClick={() => setLarge((on) => !on)} aria-pressed={large}>
            {large ? "Shrink" : "Enlarge"}
          </button>
        </div>
      )}
      <div className="player-now">
        <button type="button" className="player-title" onClick={() => props.onOpen(item)} title="Show this article">{item.title}</button>
        <span className="player-source">
          {queue.index + 1} of {queue.items.length}{queue.source ? ` · ${queue.source}` : ""}
        </span>
      </div>
      <div className="player-controls">
        <button type="button" onClick={() => updateQueue((q) => step(q, -1))} disabled={!hasPrev} aria-label="Previous in queue" title="Previous in queue">⏮</button>
        <button type="button" onClick={() => updateQueue((q) => step(q, 1))} disabled={!hasNext} aria-label="Next in queue" title="Next in queue">⏭</button>
      </div>
      {src && !isVideo && (
        <audio
          ref={(el) => { media.current = el; }}
          className="player-audio"
          src={src}
          controls
          preload="metadata"
          onTimeUpdate={(e) => saveProgress(e.currentTarget.currentTime)}
          onEnded={finished}
        />
      )}
      <div className="player-controls">
        <button type="button" onClick={() => setQueueOpen((open) => !open)} aria-expanded={queueOpen} aria-controls="player-queue">
          Queue <span className="count">{queue.items.length}</span>
        </button>
        <button type="button" onClick={() => updateQueue(() => EMPTY_QUEUE)} aria-label="Stop and clear the queue" title="Stop and clear the queue">×</button>
      </div>
      {queueOpen && (
        <section id="player-queue" className="player-queue" aria-label="Play queue">
          <div className="player-queue-head">
            <h2>Queue{queue.source ? ` · ${queue.source}` : ""}</h2>
            <button type="button" onClick={() => setQueueOpen(false)} aria-label="Close the queue">×</button>
          </div>
          <ol>
            {queue.items.map((queued, index) => (
              <li key={queued.id} className={index === queue.index ? "current" : index < queue.index ? "played" : ""}>
                <button type="button" className="player-queue-item" onClick={() => updateQueue((q) => jumpTo(q, index))} aria-current={index === queue.index}>
                  <span aria-hidden="true">{index === queue.index ? "▶" : index + 1}</span> {queued.title}
                </button>
                <button type="button" onClick={() => updateQueue((q) => removeAt(q, index))} aria-label={`Remove ${queued.title} from the queue`} title="Remove from the queue">×</button>
              </li>
            ))}
          </ol>
        </section>
      )}
    </footer>
  );
}
