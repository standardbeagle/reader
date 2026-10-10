import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type LibbyHold, type LibbyState } from "./api";
import { useDialog } from "./ListDialogs";

const NOTIFY_KEY = "reader.libby.notify";
const ANNOUNCED_KEY = "reader.libby.announcedReady";
const SUSPEND_CHOICES = [7, 14, 30, 60, 90];

const holdId = (hold: { cardId: string; titleId: string }) => `${hold.cardId}:${hold.titleId}`;
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/**
 * Raise a browser notification when a hold becomes ready. It works while
 * Reader is open in a tab or installed as an app; the hold notice in the
 * feed is the record either way.
 */
export function useLibbyNotifications(): void {
  const libby = useQuery({ queryKey: ["libby"], queryFn: api.getLibby, refetchInterval: 5 * 60_000 });
  const holds = libby.data?.linked ? libby.data.holds : null;
  useEffect(() => {
    if (!holds) return;
    const ready = holds.filter((hold) => hold.ready);
    let announced: string[] = [];
    try { announced = JSON.parse(localStorage.getItem(ANNOUNCED_KEY) ?? "[]") as string[]; } catch { /* start over */ }
    const fresh = ready.filter((hold) => !announced.includes(holdId(hold)));
    // Remember only holds that are still ready, so one that lapses and comes round again is announced again.
    localStorage.setItem(ANNOUNCED_KEY, JSON.stringify(ready.map(holdId)));
    if (fresh.length === 0 || localStorage.getItem(NOTIFY_KEY) !== "1") return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    for (const hold of fresh) {
      new Notification(`Ready to borrow: ${hold.title}`, {
        body: hold.expiresAt ? `Held for you until ${day(hold.expiresAt)}.` : "Your library hold is ready.",
        tag: `libby-${holdId(hold)}`,
      });
    }
  }, [holds]);
}

function holdStatus(hold: LibbyHold): string {
  if (hold.ready) return hold.expiresAt ? `Ready — borrow by ${day(hold.expiresAt)}` : "Ready to borrow";
  const parts = [
    hold.position !== null && `#${hold.position} in queue`,
    hold.estimatedWaitDays !== null && `about ${hold.estimatedWaitDays} days`,
    hold.suspendedUntil && `suspended until ${day(hold.suspendedUntil)}`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "In queue";
}

/** Link a Libby account, see the hold queue, and place, suspend, cancel or borrow holds. */
export function LibbyDialog(props: {
  onClose: () => void;
  /** Open the feed of hold notices. */
  onShowFeed: (feedId: string) => void;
  onActionError?: ((message: string) => void) | undefined;
}) {
  const ref = useDialog(true);
  const qc = useQueryClient();
  const libby = useQuery({ queryKey: ["libby"], queryFn: api.getLibby });
  const [code, setCode] = useState("");
  const [query, setQuery] = useState("");
  const [searchFor, setSearchFor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notify, setNotify] = useState(() => localStorage.getItem(NOTIFY_KEY) === "1");

  const showState = (state: LibbyState) => {
    qc.setQueryData(["libby"], state);
    // Every hold change adds a notice to the Libby feed.
    qc.invalidateQueries({ queryKey: ["feeds"] });
    qc.invalidateQueries({ queryKey: ["articles"] });
  };
  const failed = (e: unknown) => {
    setError(e instanceof ApiError ? e.message : "Something went wrong talking to Libby.");
    qc.invalidateQueries({ queryKey: ["libby"] });
  };
  const run = useMutation({
    mutationFn: (work: () => Promise<LibbyState>) => work(),
    onMutate: () => setError(null),
    onSuccess: showState,
    onError: failed,
  });
  const link = useMutation({
    mutationFn: () => api.linkLibby(code),
    onMutate: () => setError(null),
    onSuccess: (state) => { setCode(""); showState(state); },
    onError: failed,
  });
  const unlink = useMutation({
    mutationFn: api.unlinkLibby,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["libby"] });
      qc.invalidateQueries({ queryKey: ["feeds"] });
      qc.invalidateQueries({ queryKey: ["articles"] });
    },
    onError: failed,
  });
  const search = useQuery({
    queryKey: ["libby-search", searchFor],
    queryFn: () => api.searchLibby(searchFor),
    enabled: searchFor.length >= 2,
    retry: false,
  });

  const toggleNotify = async () => {
    if (notify) {
      localStorage.setItem(NOTIFY_KEY, "0");
      setNotify(false);
      return;
    }
    if (!("Notification" in window)) return setError("This browser cannot show notifications.");
    const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (permission !== "granted") return setError("Notifications are blocked for Reader in this browser's settings.");
    localStorage.setItem(NOTIFY_KEY, "1");
    setNotify(true);
  };

  const state = libby.data;
  const busy = run.isPending || link.isPending || unlink.isPending;
  // With Libby sync switched off in Settings the server refuses every call to Libby.
  const syncOff = state ? !state.syncEnabled : false;
  const syncOffNotice = (
    <p className="libby-error" role="alert">Libby sync is switched off. Turn on “Libby sync” in Settings to use it.</p>
  );
  const held = new Set(state?.linked ? state.holds.map(holdId) : []);

  const linkForm = (relink: boolean) => (
    <form className="libby-link" onSubmit={(event) => { event.preventDefault(); if (!busy) link.mutate(); }}>
      <label htmlFor="libby-code">Setup code</label>
      <input
        id="libby-code"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        pattern="[0-9 ]{8,9}"
        placeholder="8 digits"
        value={code}
        required
        onChange={(event) => setCode(event.target.value)}
      />
      <p className="feed-dialog-help">
        In Libby open the menu, then Settings, then “Copy To Another Device”, and choose the option that shows a code on
        this device. The code works once and expires in about a minute. Reader sends it to Libby and does not keep it.
      </p>
      <div className="feed-dialog-actions">
        <button type="submit" className="primary" disabled={busy}>{link.isPending ? "Linking…" : relink ? "Link again" : "Link Libby"}</button>
      </div>
    </form>
  );

  return (
    <dialog
      ref={ref}
      className="feed-dialog libby-dialog"
      aria-labelledby="libby-title"
      onCancel={props.onClose}
      onClose={props.onClose}
      onClick={(event) => { if (event.target === event.currentTarget) props.onClose(); }}
    >
      <div className="feed-dialog-body">
        <h2 id="libby-title">Library holds</h2>
        {error && <p className="libby-error" role="alert">{error}</p>}
        {libby.isPending && <p className="feed-dialog-sub">Loading…</p>}
        {libby.isError && <p className="libby-error" role="alert">{libby.error instanceof ApiError ? libby.error.message : "Couldn't load the Libby account."}</p>}

        {state && !state.linked && (
          <>
            <p className="feed-dialog-sub">
              Link your Libby account to follow your holds here: each change in the queue becomes a notice in a “Libby holds”
              feed, and you can place, suspend, cancel and borrow holds without leaving Reader.
            </p>
            <p className="libby-caution">
              Libby has no public interface for this. Reader signs in as another of your devices, the way the Libby app
              does, which OverDrive's terms do not cover — they can change it or cut it off at any time.
            </p>
            {syncOff ? syncOffNotice : linkForm(false)}
          </>
        )}

        {state?.linked && (
          <>
            <p className="feed-dialog-sub">
              {state.cards.map((card) => card.library).join(", ") || "Linked"}
              {state.lastSyncedAt && ` · synced ${new Date(state.lastSyncedAt).toLocaleString()}`}
            </p>
            {syncOff ? syncOffNotice : state.needsRelink ? (
              <>
                <p className="libby-error" role="alert">The Libby sign-in has lapsed. Link again with a new setup code; your hold history stays.</p>
                {linkForm(true)}
              </>
            ) : state.lastError && <p className="libby-error" role="alert">Last sync failed: {state.lastError}</p>}

            <div className="libby-toolbar">
              <button type="button" disabled={busy || syncOff || state.needsRelink} onClick={() => run.mutate(api.syncLibby)}>{run.isPending ? "Working…" : "Sync now"}</button>
              <button type="button" onClick={() => props.onShowFeed(state.feedId)}>Show hold notices</button>
              <label className="list-public-toggle">
                <input type="checkbox" checked={notify} onChange={() => void toggleNotify()} />
                Notify me when a hold is ready
              </label>
            </div>

            {state.holds.length === 0 ? <p className="feed-dialog-sub">No holds.</p> : (
              <ul className="libby-holds">
                {state.holds.map((hold) => (
                  <li key={holdId(hold)} className={hold.ready ? "ready" : ""}>
                    <div className="libby-hold-info">
                      <span className="libby-hold-title">{hold.title}</span>
                      <span className="libby-hold-meta">
                        {[hold.author, hold.format, state.cards.find((card) => card.cardId === hold.cardId)?.library].filter(Boolean).join(" · ")}
                      </span>
                      <span className="libby-hold-status">{holdStatus(hold)}</span>
                    </div>
                    <div className="libby-hold-actions">
                      {hold.ready && (
                        <button type="button" className="primary" disabled={busy || syncOff} onClick={() => run.mutate(() => api.borrowLibbyHold(hold.cardId, hold.titleId))}>Borrow</button>
                      )}
                      {hold.suspendedUntil ? (
                        <button type="button" disabled={busy || syncOff} onClick={() => run.mutate(() => api.suspendLibbyHold(hold.cardId, hold.titleId, 0))}>Resume</button>
                      ) : (
                        <select
                          aria-label={`Suspend the hold on ${hold.title}`}
                          value=""
                          disabled={busy || syncOff}
                          onChange={(event) => { const days = Number(event.target.value); if (days) run.mutate(() => api.suspendLibbyHold(hold.cardId, hold.titleId, days)); }}
                        >
                          <option value="">Suspend…</option>
                          {SUSPEND_CHOICES.map((days) => <option key={days} value={days}>for {days} days</option>)}
                        </select>
                      )}
                      <button
                        type="button"
                        disabled={busy || syncOff}
                        onClick={() => { if (confirm(`Cancel the hold on ${hold.title}? You lose your place in the queue.`)) run.mutate(() => api.cancelLibbyHold(hold.cardId, hold.titleId)); }}
                      >Cancel</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <form className="libby-search" onSubmit={(event) => { event.preventDefault(); setSearchFor(query.trim()); }}>
              <label htmlFor="libby-query">Place a hold</label>
              <div className="libby-search-row">
                <input id="libby-query" type="search" minLength={2} maxLength={100} placeholder="Title or author" value={query} onChange={(event) => setQuery(event.target.value)} />
                <button type="submit" disabled={query.trim().length < 2}>Search</button>
              </div>
            </form>
            {search.isFetching && <p className="feed-dialog-sub">Searching…</p>}
            {search.isError && <p className="libby-error" role="alert">{search.error instanceof ApiError ? search.error.message : "Search failed."}</p>}
            {search.data && (search.data.titles.length === 0 ? <p className="feed-dialog-sub">Nothing found at {search.data.library}.</p> : (
              <ul className="libby-holds">
                {search.data.titles.map((title) => (
                  <li key={title.titleId}>
                    <div className="libby-hold-info">
                      <span className="libby-hold-title">{title.title}</span>
                      <span className="libby-hold-meta">{[title.author, title.format, search.data.library].filter(Boolean).join(" · ")}</span>
                      <span className="libby-hold-status">
                        {title.available ? "Available now" : [title.holdsCount !== null && `${title.holdsCount} holds`, title.ownedCopies !== null && `${title.ownedCopies} copies`].filter(Boolean).join(" · ") || "Not available now"}
                      </span>
                    </div>
                    <div className="libby-hold-actions">
                      {held.has(holdId({ cardId: search.data.cardId, titleId: title.titleId }))
                        ? <span className="libby-hold-status">On hold</span>
                        : <button type="button" disabled={busy || syncOff || state.needsRelink} onClick={() => run.mutate(() => api.placeLibbyHold(search.data.cardId, title.titleId))}>Place hold</button>}
                    </div>
                  </li>
                ))}
              </ul>
            ))}
          </>
        )}

        <div className="feed-dialog-actions">
          {state?.linked && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => { if (confirm("Unlink Libby? The hold notices feed is removed. Your holds in Libby are not touched.")) unlink.mutate(); }}
            >Unlink</button>
          )}
          <button type="button" className="secondary" onClick={props.onClose}>Done</button>
        </div>
      </div>
    </dialog>
  );
}
