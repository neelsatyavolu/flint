import type { ReactNode } from "react";
import clsx from "clsx";

/** Label style (uppercase mono): date groups, section heads. */
export function SectionLabel({ children, className, id, as: Tag = "div" }: { children: ReactNode; className?: string; id?: string; as?: "div" | "h2" | "h3" | "span" }) {
  return <Tag id={id} className={clsx("t-label", className)}>{children}</Tag>;
}
