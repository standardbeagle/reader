import type { IngestorAdapter } from "./types.js";
import type { IngestorKind } from "../storage/types.js";
import { mastodonAdapter } from "./mastodon.js";
import { blueskyAdapter } from "./bluesky.js";
import { redditAdapter } from "./reddit.js";

export const adapters: Record<IngestorKind, IngestorAdapter> = {
  mastodon: mastodonAdapter,
  bluesky: blueskyAdapter,
  reddit: redditAdapter,
};
export type { IngestorAdapter } from "./types.js";
