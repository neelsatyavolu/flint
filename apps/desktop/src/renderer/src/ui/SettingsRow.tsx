import type { ReactNode } from "react";
import clsx from "clsx";
import styles from "./SettingsRow.module.css";

/** One setting: accent icon, title, description, control at the right (DESIGN §5 Settings). */
export function SettingsRow({ icon, title, description, children, className }: { icon?: ReactNode; title: string; description?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={clsx(styles.row, className)}>
      {icon ? <span className={styles.icon} aria-hidden>{icon}</span> : null}
      <div className={styles.text}>
        <div className={styles.title}>{title}</div>
        {description ? <div className={styles.desc}>{description}</div> : null}
      </div>
      {children ? <div className={styles.control}>{children}</div> : null}
    </div>
  );
}
