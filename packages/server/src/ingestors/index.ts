import type { IngestorAdapter } from "./types.js";
import type { IngestorKind } from "../storage/types.js";
import { mastodonAdapter } from "./mastodon.js";
import { blueskyAdapter } from "./bluesky.js";
import { redditAdapter } from "./reddit.js";
import { compositeAdapter } from "./composite.js";

export const adapters: Record<IngestorKind, IngestorAdapter> = {
  mastodon: mastodonAdapter,
  bluesky: blueskyAdapter,
  reddit: redditAdapter,
  composite: compositeAdapter,
};
export type { IngestorAdapter } from "./types.js";
