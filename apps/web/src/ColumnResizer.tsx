import { useRef } from "react";

export function ColumnResizer(props: {
  label: string;
  value: number;
  onResize: (delta: number) => void;
  className?: string;
}) {
  const lastX = useRef<number | null>(null);
  return (
    <div
      className={`column-resizer${props.className ? ` ${props.className}` : ""}`}
      role="separator"
      aria-label={props.label}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={1000}
      aria-valuenow={props.value}
      tabIndex={0}
      onPointerDown={(event) => {
        lastX.current = event.clientX;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (lastX.current === null) return;
        const delta = event.clientX - lastX.current;
        if (delta !== 0) props.onResize(delta);
        lastX.current = event.clientX;
      }}
      onPointerUp={() => { lastX.current = null; }}
      onPointerCancel={() => { lastX.current = null; }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          props.onResize(event.key === "ArrowRight" ? 16 : -16);
        }
      }}
    >
      <span aria-hidden="true" />
    </div>
  );
}
