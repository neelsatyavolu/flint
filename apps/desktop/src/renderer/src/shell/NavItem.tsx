import { useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
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
  /** What the count means, read after it by screen readers ("Inbox, 3 unread"). Empty reads the bare number. */
  countNoun?: string;
  /** Makes the row a drop target for conversations dragged from the list. */
  onDropThreads?: (ids: number[]) => void;
};

/** Drag payload set by thread list rows: a JSON array of thread ids. */
export const THREADS_MIME = "application/x-flint-threads";

/** Thread ids from a drag payload, or an empty list when it is not a JSON array of ids. */
export function parseDraggedThreads(raw: string): number[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is number => Number.isInteger(id) && id > 0) : [];
  } catch {
    return [];
  }
}

export function navAriaLabel(label: string, count: number, noun = "unread"): string {
  if (count <= 0) return label;
  return noun ? `${label}, ${count} ${noun}` : `${label}, ${count}`;
}

/** Drag-over highlight and drop handling for a row that accepts conversations. */
function useThreadDrop(onDropThreads: ((ids: number[]) => void) | undefined) {
  const [over, setOver] = useState(false);
  if (!onDropThreads) return { over: false, handlers: {} };
  const accepts = (e: DragEvent) => e.dataTransfer.types.includes(THREADS_MIME);
  const handlers = {
    onDragOver: (e: DragEvent) => {
      if (!accepts(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (!over) setOver(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
    },
    onDrop: (e: DragEvent) => {
      setOver(false);
      if (!accepts(e)) return;
      e.preventDefault();
      const ids = parseDraggedThreads(e.dataTransfer.getData(THREADS_MIME));
      if (ids.length) onDropThreads(ids);
    },
  };
  return { over, handlers };
}

/** Where the always-visible tail of a middle-truncated address starts: its last 10 characters (the end of the domain). */
function tailStart(label: string): number {
  return Math.max(label.length - 10, 1);
}

/** One 30px sidebar row. In rail mode only the icon shows, with the label in a tooltip. */
export function NavItem({ icon, label, count = 0, tone, active, depth = 0, expandable, expanded, onToggle, onClick, rail, shortcut, middleEllipsis, countNoun, onDropThreads }: NavItemProps) {
  const drop = useThreadDrop(onDropThreads);
  const ariaLabel = navAriaLabel(label, count, countNoun);
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
        <button type="button" className={clsx(styles.railItem, active && styles.active, drop.over && styles.dropOver)} aria-current={active ? "page" : undefined} aria-label={ariaLabel} onClick={onClick} {...drop.handlers}>
          {icon}
          {count > 0 ? <span className={clsx(styles.railDot, tone === "warn" && styles.railWarn)} aria-hidden /> : null}
        </button>
      </Tooltip>
    );
  }
  return (
    <div className={clsx(styles.item, depth === 1 && styles.child, active && styles.active, drop.over && styles.dropOver)} {...drop.handlers}>
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
      <button type="button" className={styles.itemMain} aria-current={active ? "page" : undefined} aria-label={ariaLabel} onClick={onClick}>
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
