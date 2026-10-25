import type { ReactNode } from "react";
import clsx from "clsx";

/** Label style (uppercase mono): date groups, section heads. */
export function SectionLabel({ children, className, as: Tag = "div" }: { children: ReactNode; className?: string; as?: "div" | "h3" | "span" }) {
  return <Tag className={clsx("t-label", className)}>{children}</Tag>;
}
