// How the reader likes things played. Kept in this browser, like the play
// queue: volume in particular belongs to the device, not the account.

export interface PlayerPrefs {
  /** Playback speed; 1 is normal. */
  rate: number;
  /** 0 to 1. */
  volume: number;
  muted: boolean;
  /** The video is shown at its larger size. */
  largeVideo: boolean;
}

export const DEFAULT_PLAYER_PREFS: PlayerPrefs = { rate: 1, volume: 1, muted: false, largeVideo: false };

const MIN_RATE = 0.25;
const MAX_RATE = 4;
const STORAGE_KEY = "reader.playerPrefs.v1";

/** Stored prefs, with anything missing or out of range replaced by its default. */
export function parsePlayerPrefs(raw: string | null): PlayerPrefs {
  let stored: Partial<Record<keyof PlayerPrefs, unknown>> = {};
  try {
    const parsed: unknown = JSON.parse(raw ?? "null");
    if (parsed && typeof parsed === "object") stored = parsed;
  } catch {
    // Unreadable prefs are the same as none.
  }
  const { rate, volume, muted, largeVideo } = stored;
  return {
    rate: typeof rate === "number" && rate >= MIN_RATE && rate <= MAX_RATE ? rate : DEFAULT_PLAYER_PREFS.rate,
    volume: typeof volume === "number" && volume >= 0 && volume <= 1 ? volume : DEFAULT_PLAYER_PREFS.volume,
    muted: typeof muted === "boolean" ? muted : DEFAULT_PLAYER_PREFS.muted,
    largeVideo: typeof largeVideo === "boolean" ? largeVideo : DEFAULT_PLAYER_PREFS.largeVideo,
  };
}

let prefs: PlayerPrefs | null = null;

export function playerPrefs(): PlayerPrefs {
  prefs ??= parsePlayerPrefs(localStorage.getItem(STORAGE_KEY));
  return prefs;
}

export function savePlayerPrefs(patch: Partial<PlayerPrefs>): void {
  // Through the parser, so a player reporting nonsense cannot store it.
  const next = parsePlayerPrefs(JSON.stringify({ ...playerPrefs(), ...patch }));
  if ((Object.keys(next) as (keyof PlayerPrefs)[]).every((key) => next[key] === prefs![key])) return;
  prefs = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // A full or blocked store only costs remembering this next time.
  }
}
