import { useRef, type ReactNode } from "react";
import clsx from "clsx";
import { rovingKeyDown } from "./roving";
import styles from "./Tabs.module.css";

export type SegmentOption<T extends string> = { value: T; label: string; icon?: ReactNode };

/** Small radio-group pill row (Focused/All, Split/Full). Arrow keys move and select. */
export function SegmentedControl<T extends string>({ options, value, onChange, label, className }: { options: SegmentOption<T>[]; value: T; onChange: (v: T) => void; label: string; className?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div role="radiogroup" aria-label={label} className={clsx(styles.segmented, className)}>
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            ref={(n) => { refs.current[i] = n; }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={clsx(styles.segment, selected && styles.segmentOn)}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => rovingKeyDown(e, i, options.length, (n) => { onChange(options[n]!.value); refs.current[n]?.focus(); })}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
