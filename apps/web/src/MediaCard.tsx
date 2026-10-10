import type { Article } from "./api";
import { currentItem, enqueue, playNow, queueItem, updateQueue, usePlayQueue } from "./playQueue";
import { safeUrl } from "./urls";
import { youtubeVideo } from "./youtube";

/**
 * An article's audio or video as a poster with Play and Queue. The player
 * itself lives in the dock, so playback carries on when the reader moves to
 * another article.
 */
export function MediaCard({ a }: { a: Article }) {
  const queue = usePlayQueue();
  const video = youtubeVideo(a.url);
  const poster = video ? `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg` : safeUrl(a.imageUrl ?? null);
  const playing = currentItem(queue)?.id === a.id;
  const queued = queue.items.some((item) => item.id === a.id);
  return (
    <figure className={`media-card${video?.short ? " media-card-short" : ""}`}>
      {poster && <img className="media-card-poster" src={poster} alt="" loading="lazy" referrerPolicy="no-referrer" />}
      <figcaption className="media-card-actions">
        {playing
          ? <span className="media-card-state" role="status">In the player below</span>
          : <button type="button" className="media-card-play" onClick={() => updateQueue((q) => playNow(q, queueItem(a)))}>▶ Play<kbd>p</kbd></button>}
        {queued
          ? !playing && <span className="media-card-state">In the queue</span>
          : <button type="button" onClick={() => updateQueue((q) => enqueue(q, queueItem(a)))}>+ Add to queue<kbd>q</kbd></button>}
      </figcaption>
    </figure>
  );
}
