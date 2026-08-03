import type { DiscoveredFeed } from "./api";

export function FeedPicker(props: {
  feeds: DiscoveredFeed[];
  pending: boolean;
  onPick: (url: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="overlay" onClick={props.onCancel}>
      <div className="picker" role="dialog" aria-label="Choose a feed" onClick={(e) => e.stopPropagation()}>
        <h2>Multiple feeds found</h2>
        <p className="sub">This site publishes more than one feed. Pick one to subscribe to.</p>
        <ul>
          {props.feeds.map((f) => (
            <li key={f.url}>
              <div className="info">
                <div className="t">{f.title}</div>
                <div className="u">{f.url}</div>
              </div>
              <span className="kind">{f.kind}</span>
              <button className="sub-btn" disabled={props.pending} onClick={() => props.onPick(f.url)}>
                Subscribe
              </button>
            </li>
          ))}
        </ul>
        <button className="cancel" onClick={props.onCancel}>Cancel</button>
      </div>
    </div>
  );
}
