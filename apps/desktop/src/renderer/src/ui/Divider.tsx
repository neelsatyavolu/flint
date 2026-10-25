import clsx from "clsx";
import styles from "./Divider.module.css";

export function Divider({ vertical = false, className }: { vertical?: boolean; className?: string }) {
  return <div role="separator" aria-orientation={vertical ? "vertical" : "horizontal"} className={clsx(styles.divider, vertical && styles.vertical, className)} />;
}
