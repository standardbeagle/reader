import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, FEED_KINDS, type Article, type FeedKind, type ListKind, type ListRule, type MediaFilter } from "./api";
import { FEED_KIND_LABELS } from "./streams";
import { setListShortcut, useListShortcuts } from "./listShortcuts";

export function useDialog(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  return ref;
}

function CreateListForm(props: {
  onCreated?: () => void;
  onActionError?: ((message: string) => void) | undefined;
  /** Offer the rule editor. Off where a list is being made to save an article into. */
  allowDynamic?: boolean;
}) {
  const [title, setTitle] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [kind, setKind] = useState<ListKind>("list");
  // A dynamic list is described by a rule instead of filled by hand.
  const [dynamic, setDynamic] = useState(false);
  const [media, setMedia] = useState<MediaFilter | "">("");
  const [feedKind, setFeedKind] = useState<FeedKind | "">("");
  const [feedCategory, setFeedCategory] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [maxAgeDays, setMaxAgeDays] = useState("");
  const qc = useQueryClient();
  const feeds = useQuery({ queryKey: ["feeds"], queryFn: api.listFeeds, enabled: dynamic });
  const feedCategories = [...new Set((feeds.data ?? []).flatMap((f) => (f.category ? [f.category] : [])))].sort((a, b) => a.localeCompare(b));
  const rule = (): ListRule => ({
    ...(media ? { media } : {}),
    ...(feedKind ? { feedKind } : {}),
    ...(feedCategory ? { feedCategory } : {}),
    ...(unreadOnly ? { unreadOnly } : {}),
    ...(Number(maxAgeDays) >= 1 ? { maxAgeDays: Math.floor(Number(maxAgeDays)) } : {}),
  });
  const create = useMutation({
    mutationFn: () => api.createList({ title: title.trim(), visibility: isPublic ? "public" : "private", kind, ...(dynamic ? { rule: rule() } : {}) }),
    onSuccess: () => {
      setTitle("");
      setIsPublic(false);
      setKind("list");
      setDynamic(false);
      qc.invalidateQueries({ queryKey: ["lists"] });
      props.onCreated?.();
    },
    onError: () => props.onActionError?.(`Could not create that ${kind}.`),
  });
  return (
    <form className="list-create-form" onSubmit={(event) => {
      event.preventDefault();
      if (!title.trim() || create.isPending) return;
      create.mutate();
    }}>
      <fieldset className="list-kind">
        <legend>Kind</legend>
        <label className="list-public-toggle">
          <input type="radio" name="list-kind" checked={kind === "list"} onChange={() => setKind("list")} />
          List — permanent: it keeps what you save to it
        </label>
        <label className="list-public-toggle">
          <input type="radio" name="list-kind" checked={kind === "playlist"} onChange={() => setKind("playlist")} />
          Playlist — a named play queue: it remembers where you are, and each item drops off once played
        </label>
      </fieldset>
      <label htmlFor="list-title">Name</label>
      <input
        id="list-title"
        type="text"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        maxLength={200}
        required
      />
      <label className="list-public-toggle">
        <input
          type="checkbox"
          checked={isPublic}
          onChange={(event) => setIsPublic(event.target.checked)}
        />
        Public — anyone with the RSS link can read it
      </label>
      {props.allowDynamic && (
        <label className="list-public-toggle">
          <input type="checkbox" checked={dynamic} onChange={(event) => setDynamic(event.target.checked)} />
          Fill automatically — it holds whatever matches a rule right now
        </label>
      )}
      {dynamic && (
        <fieldset className="list-rule">
          <legend>Include articles that match all of</legend>
          <label htmlFor="rule-media">Media</label>
          <select id="rule-media" value={media} onChange={(event) => setMedia(event.target.value as MediaFilter | "")}>
            <option value="">Anything, playable or not</option>
            <option value="any">Audio or video</option>
            <option value="audio">Audio only</option>
            <option value="video">Video only</option>
          </select>
          <label htmlFor="rule-kind">Feed type</label>
          <select id="rule-kind" value={feedKind} onChange={(event) => setFeedKind(event.target.value as FeedKind | "")}>
            <option value="">Any type</option>
            {FEED_KINDS.map((kind) => <option key={kind} value={kind}>{FEED_KIND_LABELS[kind]}</option>)}
          </select>
          <label htmlFor="rule-category">Feed category</label>
          <select id="rule-category" value={feedCategory} onChange={(event) => setFeedCategory(event.target.value)}>
            <option value="">Any category</option>
            {feedCategories.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <label htmlFor="rule-age">Published within (days)</label>
          <input id="rule-age" type="number" min={1} max={3650} placeholder="Any time" value={maxAgeDays} onChange={(event) => setMaxAgeDays(event.target.value)} />
          <label className="list-public-toggle">
            <input type="checkbox" checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)} />
            Unread only — an article leaves once it is read or played
          </label>
        </fieldset>
      )}
      <div className="feed-dialog-actions">
        <button type="submit" className="primary" disabled={create.isPending || !title.trim()}>
          {create.isPending ? "Creating…" : kind === "playlist" ? "Create playlist" : "Create list"}
        </button>
      </div>
    </form>
  );
}

export function CreateListDialog(props: { open: boolean; onClose: () => void; onActionError?: ((message: string) => void) | undefined }) {
  const ref = useDialog(props.open);
  return (
    <dialog
      ref={ref}
      className="feed-dialog"
      aria-labelledby="create-list-title"
      onCancel={props.onClose}
      onClose={props.onClose}
      onClick={(event) => { if (event.target === event.currentTarget) props.onClose(); }}
    >
      <div className="feed-dialog-body">
        <h2 id="create-list-title">New list or playlist</h2>
        <p className="feed-dialog-sub">Either one holds articles you save, kept in order, or fills itself from a rule. A public one is itself an RSS feed you can share.</p>
        <CreateListForm onCreated={props.onClose} onActionError={props.onActionError} allowDynamic />
        <div className="feed-dialog-actions">
          <button type="button" className="secondary" onClick={props.onClose}>Cancel</button>
        </div>
      </div>
    </dialog>
  );
}

export function SaveToListDialog(props: { article: Article; onClose: () => void; onActionError?: ((message: string) => void) | undefined }) {
  const ref = useDialog(true);
  const qc = useQueryClient();
  const lists = useQuery({ queryKey: ["lists"], queryFn: api.listLists });
  const shortcuts = useListShortcuts();
  // The full record carries listIds; list rows do not.
  const detail = useQuery({ queryKey: ["article", props.article.id], queryFn: () => api.getArticle(props.article.id) });
  const memberOf = new Set(detail.data?.listIds ?? props.article.listIds ?? []);
  // A dynamic list fills itself from its rule; only manual lists can be saved to.
  const manualLists = (lists.data ?? []).filter((list) => !list.rule);
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["lists"] });
    qc.invalidateQueries({ queryKey: ["articles"] });
    qc.invalidateQueries({ queryKey: ["article", props.article.id] });
  };
  const toggle = useMutation({
    mutationFn: ({ listId, save }: { listId: string; save: boolean }) =>
      save ? api.addToList(listId, props.article.id) : api.removeFromList(listId, props.article.id),
    onSuccess: invalidate,
    onError: () => props.onActionError?.("Could not update that list."),
  });
  return (
    <dialog
      ref={ref}
      className="feed-dialog"
      aria-labelledby="save-list-title"
      onCancel={props.onClose}
      onClose={props.onClose}
      onClick={(event) => { if (event.target === event.currentTarget) props.onClose(); }}
    >
      <div className="feed-dialog-body">
        <h2 id="save-list-title">Save to list</h2>
        <p className="feed-dialog-sub">{props.article.title}</p>
        {manualLists.length > 0 && (
          <ul className="list-picker">
            {manualLists.map((list) => (
              <li key={list.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={memberOf.has(list.id)}
                    disabled={toggle.isPending}
                    onChange={(event) => toggle.mutate({ listId: list.id, save: event.target.checked })}
                  />
                  {list.title}
                  {list.visibility === "public" && <span className="platform-badge">public</span>}
                </label>
                <input
                  className="list-key-input"
                  type="text"
                  value={shortcuts[list.id] ?? ""}
                  maxLength={1}
                  placeholder="key"
                  title="Keyboard shortcut: save the current article to this list"
                  aria-label={`Keyboard shortcut for ${list.title}`}
                  onChange={(event) => {
                    const key = event.target.value.slice(-1);
                    const error = setListShortcut(list.id, key || null);
                    if (error) props.onActionError?.(error);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
        <CreateListForm onActionError={props.onActionError} />
        <div className="feed-dialog-actions">
          <button type="button" className="secondary" onClick={props.onClose}>Done</button>
        </div>
      </div>
    </dialog>
  );
}
