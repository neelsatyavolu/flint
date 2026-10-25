import type { ReactNode } from "react";
import clsx from "clsx";
import styles from "./PaneHeader.module.css";

/**
 * Top strip of a pane: drag region, title, trailing actions. The left padding grows when
 * the macOS traffic lights sit over this pane (sidebar hidden or collapsed to a rail).
 */
export function PaneHeader({ title, subtitle, leading, children, className }: { title?: ReactNode; subtitle?: ReactNode; leading?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <header className={clsx(styles.header, "drag", className)}>
      {leading}
      {title ? (
        <div className={styles.titles}>
          <h1 className="t-title">{title}</h1>
          {subtitle ? <span className={clsx("t-body", styles.subtitle)}>{subtitle}</span> : null}
        </div>
      ) : null}
      <div className={clsx(styles.actions, "no-drag")}>{children}</div>
    </header>
  );
}
