import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { Button } from "../../ui";
import styles from "./settings.module.css";

/** List at the left, editor for the selected item (or a new one) at the right. */
export function ListEditor<T extends { id: number }>({ items, selectedId, onSelect, onNew, newLabel, render, empty, children }: {
  items: T[];
  selectedId: number | "new" | null;
  onSelect: (id: number) => void;
  onNew: () => void;
  newLabel: string;
  render: (item: T) => { title: ReactNode; sub?: ReactNode };
  empty: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.split}>
      <div>
        <Button variant="ghost" size="sm" icon={<Plus size={14} strokeWidth={1.5} />} onClick={onNew} style={{ marginBottom: "var(--s-3)" }}>{newLabel}</Button>
        <div className={styles.list} role="list">
          {items.map((it) => {
            const r = render(it);
            return (
              <button key={it.id} type="button" role="listitem" aria-current={selectedId === it.id} className={`${styles.listItem} ${selectedId === it.id ? styles.listOn : ""}`} onClick={() => onSelect(it.id)}>
                <span className={styles.rowTitle}>{r.title}</span>
                {r.sub ? <span className={`${styles.rowSub} ${styles.mono}`} style={{ maxWidth: "100%" }}>{r.sub}</span> : null}
              </button>
            );
          })}
          {items.length === 0 ? <p className={styles.muted} style={{ padding: "var(--s-3) 0" }}>{empty}</p> : null}
        </div>
      </div>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}
