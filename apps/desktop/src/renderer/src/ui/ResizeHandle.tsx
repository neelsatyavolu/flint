import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import clsx from "clsx";
import { readStoredNumber, writeStored } from "../lib/storage";
import styles from "./ResizeHandle.module.css";

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** A size persisted in localStorage under `key` (guarded), clamped to [min, max]. */
export function usePersistedSize(key: string, initial: number, min: number, max: number): [number, (n: number) => void] {
  const [size, setSizeState] = useState(() => clamp(readStoredNumber(key, initial), min, max));
  const setSize = useCallback(
    (n: number) => {
      const next = clamp(n, min, max);
      setSizeState(next);
      writeStored(key, String(next));
    },
    [key, min, max],
  );
  return [size, setSize];
}

type Props = {
  /** Current width of the pane being resized. */
  value: number;
  min: number;
  max: number;
  onResize: (width: number) => void;
  /** 'right' = the pane is left of the handle (dragging right grows it); 'left' = pane is right of the handle. */
  side?: "right" | "left";
  onReset?: () => void;
  label?: string;
  className?: string;
};

/** 1px hairline with an 8px hit area. Drag with the pointer, or focus and use the arrow keys (Shift = 48px). */
export function ResizeHandle({ value, min, max, onResize, side = "right", onReset, label = "Resize pane", className }: Props) {
  const drag = useRef<{ x: number; start: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const sign = side === "right" ? 1 : -1;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, start: value };
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    onResize(clamp(drag.current.start + sign * (e.clientX - drag.current.x), min, max));
  };
  const end = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === "ArrowRight") onResize(clamp(value + sign * step, min, max));
    else if (e.key === "ArrowLeft") onResize(clamp(value - sign * step, min, max));
    else if (e.key === "Home") onResize(min);
    else if (e.key === "End") onResize(max);
    else return;
    e.preventDefault();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      className={clsx(styles.handle, "no-drag", dragging && styles.dragging, className)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  );
}
