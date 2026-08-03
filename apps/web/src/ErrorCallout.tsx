import { describeError } from "./errors";

export function ErrorCallout(props: { code: string | null; onDismiss: () => void }) {
  const info = describeError(props.code);
  return (
    <div className="callout" role="alert">
      <h3>{info.title}</h3>
      <p>{info.explanation}</p>
      <ol>{info.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
      <div className="callout-actions">
        <button onClick={props.onDismiss}>Dismiss</button>
      </div>
    </div>
  );
}
