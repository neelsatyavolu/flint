import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import clsx from "clsx";
import { Tooltip } from "../ui";
import styles from "./Sidebar.module.css";

export type NavItemProps = {
  icon?: ReactNode;
  label: string;
  count?: number;
  /** warn marks counts that need a decision, such as sends awaiting approval. */
  tone?: "warn";
  active?: boolean;
  depth?: 0 | 1;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  onClick: () => void;
  rail?: boolean;
  shortcut?: string;
  /** Cut long labels (addresses) in the middle so the domain stays visible; the full text is the tooltip. */
  middleEllipsis?: boolean;
};

/** Where the always-visible tail of a middle-truncated address starts: its last 10 characters (the end of the domain). */
function tailStart(label: string): number {
  return Math.max(label.length - 10, 1);
}

/** One 30px sidebar row. In rail mode only the icon shows, with the label in a tooltip. */
export function NavItem({ icon, label, count = 0, tone, active, depth = 0, expandable, expanded, onToggle, onClick, rail, shortcut, middleEllipsis }: NavItemProps) {
  const labelRef = useRef<HTMLSpanElement>(null);
  const fullWidth = useRef(0);
  const [overflowing, setOverflowing] = useState(false);
  // Only cut in the middle when the whole label does not fit; a label that fits is shown as is.
  useLayoutEffect(() => {
    const el = labelRef.current;
    if (!middleEllipsis || !el || typeof ResizeObserver === "undefined") return;
    fullWidth.current = 0;
    const check = () => {
      if (el.querySelector("[data-label-head]") === null) fullWidth.current = el.scrollWidth;
      setOverflowing(fullWidth.current > el.clientWidth);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    // Text width changes when the web font arrives, without the box resizing.
    let live = true;
    void document.fonts?.ready.then(() => live && check());
    return () => {
      live = false;
      ro.disconnect();
    };
  }, [middleEllipsis, label, rail]);
  if (rail) {
    return (
      <Tooltip label={label} shortcut={shortcut} placement="right">
        <button type="button" className={clsx(styles.railItem, active && styles.active)} aria-current={active ? "page" : undefined} aria-label={label} onClick={onClick}>
          {icon}
          {count > 0 ? <span className={clsx(styles.railDot, tone === "warn" && styles.railWarn)} aria-hidden /> : null}
        </button>
      </Tooltip>
    );
  }
  return (
    <div className={clsx(styles.item, depth === 1 && styles.child, active && styles.active)}>
      {expandable ? (
        <button
          type="button"
          className={clsx(styles.chevron, expanded && styles.chevronOpen)}
          aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
          aria-expanded={expanded}
          onClick={onToggle}
        >
          <ChevronRight size={12} strokeWidth={1.5} />
        </button>
      ) : null}
      <button type="button" className={styles.itemMain} aria-current={active ? "page" : undefined} onClick={onClick}>
        {icon ? <span className={styles.icon}>{icon}</span> : null}
        <span ref={labelRef} className={styles.label} title={middleEllipsis ? label : undefined}>
          {middleEllipsis && overflowing ? (
            <>
              <span className={styles.labelHead} data-label-head>{label.slice(0, tailStart(label))}</span>
              <span className={styles.labelTail}>{label.slice(tailStart(label))}</span>
            </>
          ) : (
            label
          )}
        </span>
        {count > 0 ? <span className={clsx("t-data", styles.count, tone === "warn" && styles.countWarn)}>{count > 999 ? "999+" : count}</span> : null}
      </button>
    </div>
  );
}
