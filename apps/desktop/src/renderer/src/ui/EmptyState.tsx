import type { ReactNode } from "react";
import clsx from "clsx";
import { FlintMark } from "./FlintMark";
import styles from "./EmptyState.module.css";

/** Centered Flint mark in --fg-4. With no title it is the bare reader empty state. */
export function EmptyState({ title, description, action, markSize = 96, className }: { title?: string; description?: string; action?: ReactNode; markSize?: number; className?: string }) {
  return (
    <div className={clsx(styles.empty, className)}>
      <FlintMark size={markSize} className={styles.mark} />
      {title ? <h2 className="t-title">{title}</h2> : null}
      {description ? <p className={styles.desc}>{description}</p> : null}
      {action}
    </div>
  );
}
