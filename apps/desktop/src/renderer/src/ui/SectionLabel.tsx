import type { ReactNode } from "react";
import clsx from "clsx";
import styles from "./SectionLabel.module.css";

/**
 * Label style (Geist Mono 12, sentence case): date groups, section heads.
 * With `rule`, it opens a group (DESIGN §5 Section rules): a --line-strong top rule, the label under it in --fg,
 * and optional `meta` (a count, a time) at the right in --fg-3.
 */
export function SectionLabel({ children, className, id, as: Tag = "div", rule = false, meta }: { children: ReactNode; className?: string; id?: string; as?: "div" | "h2" | "h3" | "span"; rule?: boolean; meta?: ReactNode }) {
  if (!rule) return <Tag id={id} className={clsx("t-label", className)}>{children}</Tag>;
  return (
    <div className={clsx(styles.rule, className)}>
      <Tag id={id} className={clsx("t-label", styles.label)}>{children}</Tag>
      {meta ? <span className={clsx("t-label", styles.meta)}>{meta}</span> : null}
    </div>
  );
}
