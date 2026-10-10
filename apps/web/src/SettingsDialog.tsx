import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Settings } from "./api";
import { useDialog } from "./ListDialogs";

export function SettingsDialog(props: { onClose: () => void; onActionError?: ((message: string) => void) | undefined }) {
  const ref = useDialog(true);
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const update = useMutation({
    mutationFn: (patch: Partial<Settings>) => api.updateSettings(patch),
    onSuccess: (saved) => {
      qc.setQueryData(["settings"], saved);
      qc.invalidateQueries({ queryKey: ["libby"] });
    },
    onError: (e) => props.onActionError?.(e instanceof ApiError ? e.message : "Could not save that setting."),
  });

  return (
    <dialog
      ref={ref}
      className="feed-dialog"
      aria-labelledby="settings-title"
      onCancel={props.onClose}
      onClose={props.onClose}
      onClick={(event) => { if (event.target === event.currentTarget) props.onClose(); }}
    >
      <div className="feed-dialog-body">
        <h2 id="settings-title">Settings</h2>
        {settings.isPending && <p className="feed-dialog-sub">Loading…</p>}
        {settings.isError && <p className="libby-error" role="alert">Couldn't load settings.</p>}
        {settings.data && (
          <>
            <label className="list-public-toggle">
              <input
                type="checkbox"
                checked={settings.data.libbySyncEnabled}
                disabled={update.isPending}
                onChange={(event) => update.mutate({ libbySyncEnabled: event.target.checked })}
              />
              Libby sync (private API)
            </label>
            <p className="libby-caution">
              Lets Reader sign in to Libby as one of your devices to follow and change your library holds. Libby has no
              public interface for this and OverDrive's terms do not cover it — they can change it or cut it off at any
              time. While this is off Reader sends nothing to Libby's sync service; a linked account stays linked and
              picks up again when you turn it back on.
            </p>
          </>
        )}
        <div className="feed-dialog-actions">
          <button type="button" className="secondary" onClick={props.onClose}>Done</button>
        </div>
      </div>
    </dialog>
  );
}
