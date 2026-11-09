import type { ReactNode } from "react";
import clsx from "clsx";
import styles from "./EmptyState.module.css";

/**
 * A serif line in --fg-2 (Headline small), an optional description and one optional ghost action. No mark or
 * illustration (DESIGN §9). With no title it is the reader's "No conversation selected".
 * `markSize` is accepted for older callers and ignored.
 */
export function EmptyState({ title = "No conversation selected", description, action, className }: { title?: string; description?: string; action?: ReactNode; markSize?: number; className?: string }) {
  return (
    <div className={clsx(styles.empty, className)}>
      <h2 className={clsx("t-headline-sm", styles.title)}>{title}</h2>
      {description ? <p className={styles.desc}>{description}</p> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
