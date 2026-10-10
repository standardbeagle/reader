import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Feed } from "./api";
import { useDialog } from "./ListDialogs";

/** File a feed under a category: pick an existing one, type a new one, or clear it. */
export function FeedCategoryDialog(props: {
  feed: Feed;
  /** Categories already in use, offered as suggestions. */
  categories: string[];
  onClose: () => void;
  onActionError?: ((message: string) => void) | undefined;
}) {
  const ref = useDialog(true);
  const [category, setCategory] = useState(props.feed.category ?? "");
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (next: string | null) => api.setFeedCategory(props.feed.id, next),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feeds"] });
      qc.invalidateQueries({ queryKey: ["lists"] });
      props.onClose();
    },
    onError: () => props.onActionError?.("Could not change that feed's category."),
  });
  return (
    <dialog
      ref={ref}
      className="feed-dialog"
      aria-labelledby="feed-category-title"
      onCancel={props.onClose}
      onClose={props.onClose}
      onClick={(event) => { if (event.target === event.currentTarget) props.onClose(); }}
    >
      <form className="feed-dialog-body" onSubmit={(event) => { event.preventDefault(); save.mutate(category.trim() || null); }}>
        <h2 id="feed-category-title">Category</h2>
        <p className="feed-dialog-sub">{props.feed.title}</p>
        <label htmlFor="feed-category">Category name</label>
        <input
          id="feed-category"
          type="text"
          list="feed-category-options"
          value={category}
          maxLength={60}
          autoFocus
          onChange={(event) => setCategory(event.target.value)}
        />
        <datalist id="feed-category-options">
          {props.categories.map((name) => <option key={name} value={name} />)}
        </datalist>
        <p className="feed-dialog-help">Feeds in a category group together in the sidebar, and the category is a stream you can open, play, or build a list from. Leave it empty to remove the feed from its category.</p>
        <div className="feed-dialog-actions">
          <button type="button" className="secondary" onClick={props.onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </dialog>
  );
}
