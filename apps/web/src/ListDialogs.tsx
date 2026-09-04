import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Article } from "./api";
import { setListShortcut, useListShortcuts } from "./listShortcuts";

function useDialog(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  return ref;
}

function CreateListForm(props: { onCreated?: () => void; onActionError?: ((message: string) => void) | undefined }) {
  const [title, setTitle] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: () => api.createList({ title: title.trim(), visibility: isPublic ? "public" : "private" }),
    onSuccess: () => {
      setTitle("");
      setIsPublic(false);
      qc.invalidateQueries({ queryKey: ["lists"] });
      props.onCreated?.();
    },
    onError: () => props.onActionError?.("Could not create that list."),
  });
  return (
    <form className="list-create-form" onSubmit={(event) => {
      event.preventDefault();
      if (!title.trim() || create.isPending) return;
      create.mutate();
    }}>
      <label htmlFor="list-title">List name</label>
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
        Public — anyone with the RSS link can read this list
      </label>
      <div className="feed-dialog-actions">
        <button type="submit" className="primary" disabled={create.isPending || !title.trim()}>
          {create.isPending ? "Creating…" : "Create list"}
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
        <h2 id="create-list-title">New list</h2>
        <p className="feed-dialog-sub">Lists keep articles permanently. A public list is itself an RSS feed you can share.</p>
        <CreateListForm onCreated={props.onClose} onActionError={props.onActionError} />
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
        {(lists.data ?? []).length > 0 && (
          <ul className="list-picker">
            {(lists.data ?? []).map((list) => (
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
