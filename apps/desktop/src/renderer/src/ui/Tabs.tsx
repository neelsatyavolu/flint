import { useId, useRef, type ReactNode } from "react";
import clsx from "clsx";
import { rovingKeyDown } from "./roving";
import styles from "./Tabs.module.css";

export type TabItem<T extends string> = { id: T; label: string; count?: number };

/** Underline tabs. Render the active panel as `children`; the panel gets role="tabpanel" wired to the tab. */
export function Tabs<T extends string>({ tabs, value, onChange, label, children, className }: { tabs: TabItem<T>[]; value: T; onChange: (id: T) => void; label: string; children?: ReactNode; className?: string }) {
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div className={className}>
      <div role="tablist" aria-label={label} className={styles.tablist}>
        {tabs.map((t, i) => {
          const selected = t.id === value;
          return (
            <button
              key={t.id}
              ref={(n) => { refs.current[i] = n; }}
              type="button"
              role="tab"
              id={`${base}-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel`}
              tabIndex={selected ? 0 : -1}
              className={clsx(styles.tab, selected && styles.tabOn)}
              onClick={() => onChange(t.id)}
              onKeyDown={(e) => rovingKeyDown(e, i, tabs.length, (n) => { onChange(tabs[n]!.id); refs.current[n]?.focus(); })}
            >
              {t.label}
              {t.count ? <span className={styles.count}>{t.count}</span> : null}
            </button>
          );
        })}
      </div>
      {children !== undefined ? <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${value}`}>{children}</div> : null}
    </div>
  );
}
