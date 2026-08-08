const shortcuts = [
  ["j / k", "next / previous article"],
  ["r", "refresh selected feed"],
  ["o", "open original"],
  ["[ / ]", "collapse feeds / articles"],
  ["?", "show all shortcuts"],
  ["Esc", "close shortcut help"],
] as const;

export function ShortcutHints(props: {
  open: boolean;
  notice: string | null;
  onToggle: () => void;
}) {
  return (
    <>
      <aside className="shortcut-hints" aria-label="Keyboard shortcuts">
        <button className="shortcut-toggle" onClick={props.onToggle} aria-expanded={props.open} aria-controls="shortcut-help">
          <kbd>?</kbd><span>keys</span>
        </button>
        <span><kbd>j</kbd>/<kbd>k</kbd> browse</span>
        <span><kbd>r</kbd> refresh</span>
        <span><kbd>o</kbd> open</span>
      </aside>
      {props.open && (
        <aside id="shortcut-help" className="shortcut-popover" role="dialog" aria-label="Keyboard shortcuts">
          <div className="shortcut-popover-head">
            <h2>Keyboard shortcuts</h2>
            <button onClick={props.onToggle} aria-label="Close keyboard shortcuts">×</button>
          </div>
          <dl>
            {shortcuts.map(([key, label]) => (
              <div key={key}><dt><kbd>{key}</kbd></dt><dd>{label}</dd></div>
            ))}
          </dl>
        </aside>
      )}
      {props.notice && <div className="shortcut-notice" role="status" aria-live="polite">{props.notice}</div>}
    </>
  );
}
