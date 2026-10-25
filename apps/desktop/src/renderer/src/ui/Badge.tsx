import type { ReactNode } from "react";
import clsx from "clsx";
import styles from "./Badge.module.css";

export type BadgeTone = "neutral" | "accent" | "ok" | "warn" | "danger";

/** Small Data-style chip: statuses, thread counts. */
export function Badge({ tone = "neutral", children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return <span className={clsx(styles.badge, styles[tone], className)}>{children}</span>;
}

/** Numeric chip, e.g. the message count on a thread row. Hidden at zero unless `showZero`. */
export function CountChip({ count, tone = "neutral", showZero = false, className }: { count: number; tone?: BadgeTone; showZero?: boolean; className?: string }) {
  if (count === 0 && !showZero) return null;
  return <Badge tone={tone} className={className}>{count > 999 ? "999+" : count}</Badge>;
}
