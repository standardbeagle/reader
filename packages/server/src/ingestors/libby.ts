import type { NormalizedItem } from "../storage/types.js";
import { libbyToken } from "../libby/account.js";
import { syncAccount, type LibbyCard, type LibbyHold, type LibbySync } from "../libby/client.js";
import type { IngestorAdapter } from "./types.js";

// A hold is not an article: it is one thing whose state changes over weeks.
// This adapter turns each change worth knowing about into one feed item, so
// read state, snooze, lists and unread counts apply to hold notices unchanged.
// A sync that finds nothing new emits nothing — silence is the design.

/** A hold as last seen, plus what has been announced about it. */
export interface TrackedHold extends LibbyHold {
  /** Notices emitted for this hold so far; makes every notice's id unique. */
  seq: number;
  /** The queue position the last notice reported. */
  announcedPosition: number | null;
}

/** The adapter's cursor: the account as of the last sync. Also what the holds view reads. */
export interface LibbySnapshot {
  cards: LibbyCard[];
  holds: Record<string, TrackedHold>;
}

/** A queue is worth announcing once the wait is short, or after a real jump. */
const NEAR_FRONT = 10;
const BIG_JUMP = 5;
const BIG_JUMP_RATIO = 0.25;

export const holdKey = (hold: { cardId: string; titleId: string }): string => `${hold.cardId}:${hold.titleId}`;

const day = (date: Date): string => date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function movedEnough(from: number, to: number): boolean {
  if (to >= from) return false;
  return to <= NEAR_FRONT || from - to >= BIG_JUMP || (from - to) / from >= BIG_JUMP_RATIO;
}

/**
 * Compare a sync against the last snapshot. Returns the notices to deliver
 * and the snapshot to store. Each notice is one line: the reader body
 * collapses newlines, so details are joined with " · ".
 */
export function diffHolds(previous: LibbySnapshot | null, sync: LibbySync, now: Date): { items: NormalizedItem[]; snapshot: LibbySnapshot } {
  const items: NormalizedItem[] = [];
  const holds: Record<string, TrackedHold> = {};
  const libraryOf = new Map(sync.cards.map((c) => [c.cardId, c.library]));
  const about = (hold: LibbyHold): string[] => [hold.format && hold.format[0]!.toUpperCase() + hold.format.slice(1), libraryOf.get(hold.cardId)]
    .filter((part): part is string => Boolean(part));
  const estimate = (hold: LibbyHold) => hold.estimatedWaitDays === null ? null
    : `estimated available ${day(new Date(now.getTime() + hold.estimatedWaitDays * 86_400_000))} (~${hold.estimatedWaitDays} days)`;
  const notice = (hold: LibbyHold, seq: number, kind: string, title: string, details: (string | null | false)[]) => {
    items.push({
      externalId: `hold:${holdKey(hold)}:${seq}:${kind}`,
      author: hold.author,
      title,
      text: details.filter(Boolean).join(" · "),
      url: `https://share.libbyapp.com/title/${encodeURIComponent(hold.titleId)}`,
      publishedAt: now.toISOString(),
    });
  };

  for (const hold of sync.holds) {
    const key = holdKey(hold);
    const before = previous?.holds[key];
    const tracked: TrackedHold = { ...hold, seq: before?.seq ?? 0, announcedPosition: before?.announcedPosition ?? null };
    const emit = (kind: string, title: string, details: (string | null | false)[]) => {
      tracked.seq += 1;
      tracked.announcedPosition = hold.position;
      notice(hold, tracked.seq, kind, title, details);
    };
    const borrowBy = hold.expiresAt ? day(new Date(hold.expiresAt)) : null;
    if (hold.ready && !before?.ready) {
      emit("ready", `Ready now · ${hold.title}${borrowBy ? ` · borrow by ${borrowBy}` : ""}`, [
        "Available now", borrowBy && `your reservation is held until ${borrowBy}`, ...about(hold), "borrow it from the Libby holds view or in Libby",
      ]);
    } else if (!before) {
      emit("placed", `Hold placed · ${hold.title}${hold.position !== null ? ` · #${hold.position} in queue` : ""}`, [
        ...about(hold),
        hold.position !== null && `you are #${hold.position} in the queue`,
        hold.holdsCount !== null && `${hold.holdsCount} active holds`,
        hold.ownedCopies !== null && `${hold.ownedCopies} ${hold.ownedCopies === 1 ? "copy" : "copies"}`,
        estimate(hold),
        hold.suspendedUntil && `suspended until ${day(new Date(hold.suspendedUntil))}`,
      ]);
    } else if (hold.suspendedUntil && !before.suspendedUntil) {
      emit("suspended", `Hold suspended · ${hold.title} · until ${day(new Date(hold.suspendedUntil))}`, [
        `Suspended until ${day(new Date(hold.suspendedUntil))}`, "it keeps moving up the queue but will not be delivered before then", ...about(hold),
      ]);
    } else if (!hold.suspendedUntil && before.suspendedUntil) {
      emit("resumed", `Hold resumed · ${hold.title}${hold.position !== null ? ` · #${hold.position} in queue` : ""}`, [
        "The suspension has ended", hold.position !== null && `you are #${hold.position} in the queue`, estimate(hold), ...about(hold),
      ]);
    } else if (hold.position !== null && before.announcedPosition !== null && movedEnough(before.announcedPosition, hold.position)) {
      const from = before.announcedPosition;
      emit("moved", `Moving up · ${hold.title} · #${hold.position}, was #${from}`, [
        `You moved from #${from} to #${hold.position}`, estimate(hold), ...about(hold),
      ]);
    }
    holds[key] = tracked;
  }

  for (const [key, gone] of Object.entries(previous?.holds ?? {})) {
    if (holds[key]) continue;
    // Libby does not say why a hold left the queue; what replaced it does.
    if (sync.loans.has(key)) {
      notice(gone, gone.seq + 1, "borrowed", `Borrowed · ${gone.title}`, ["The hold became a loan", ...about(gone), "open it in Libby to read or listen"]);
    } else if (gone.ready) {
      notice(gone, gone.seq + 1, "expired", `Hold ended · ${gone.title}`, [
        "The reserved copy was not borrowed and the hold is gone", gone.expiresAt && `it was held until ${day(new Date(gone.expiresAt))}`, ...about(gone), "place a new hold to rejoin the queue",
      ]);
    } else {
      notice(gone, gone.seq + 1, "cancelled", `Hold cancelled · ${gone.title}`, [
        "The hold is no longer in your queue", gone.position !== null && `last position #${gone.position}`, ...about(gone),
      ]);
    }
  }
  return { items, snapshot: { cards: sync.cards, holds } };
}

/** The stored snapshot, or null before the first sync. */
export function libbySnapshot(cursor: Record<string, unknown> | null): LibbySnapshot | null {
  return cursor && Array.isArray(cursor.cards) && cursor.holds && typeof cursor.holds === "object" ? cursor as unknown as LibbySnapshot : null;
}

export const libbyAdapter: IngestorAdapter = {
  async validate(config, ctx) {
    const credential = typeof config.credentialId === "string" ? ctx.storage.getCredential(config.credentialId) : null;
    if (credential?.provider !== "libby") throw new Error("libby needs a linked Libby account");
    return "Libby holds";
  },
  async fetch(config, cursor, ctx) {
    const token = await libbyToken(ctx.storage, String(config.credentialId));
    const { items, snapshot } = diffHolds(libbySnapshot(cursor), await syncAccount(token), new Date());
    return { items, cursor: snapshot as unknown as Record<string, unknown> };
  },
};
