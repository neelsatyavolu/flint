import { memo } from "react";
import { Archive, Bell, ChevronRight, MailOpen, Newspaper } from "lucide-react";
import clsx from "clsx";
import type { Bundle } from "@flint/core";
import { IconButton } from "../../ui";
import { formatListTime, displayName } from "../../lib/format";
import { rowDomId } from "./ThreadRow";
import styles from "./BundleRow.module.css";

export const BUNDLE_TITLES: Record<Bundle["category"], string> = { notifications: "Notifications", newsletters: "Newsletters" };

type Props = {
  bundle: Bundle;
  compact: boolean;
  cursor: boolean;
  now: number;
  onOpen: (b: Bundle) => void;
  /** "Mark all as read" / "Archive all" for the whole bundle. */
  onTriage?: (b: Bundle, kind: "read" | "archive") => void;
};

function BundleRowImpl({ bundle, compact, cursor, now, onOpen, onTriage }: Props) {
  const Glyph = bundle.category === "notifications" ? Bell : Newspaper;
  const first = bundle.latest[0];
  const unread = bundle.unreadCount > 0;
  return (
    <div
      role="option"
      id={rowDomId(`b:${bundle.category}`)}
      aria-selected={false}
      data-bundle={bundle.category}
      className={clsx(styles.row, "t-body", compact && styles.compact, unread && styles.unread, cursor && styles.cursor)}
      onClick={() => onOpen(bundle)}
    >
      {unread ? <span className="sr-only">Unread</span> : null}
      <span className={clsx(styles.glyph, compact ? styles.g24 : styles.g32)}><Glyph size={compact ? 13 : 16} strokeWidth={1.5} /></span>
      <div className={styles.body}>
        <div className={styles.line}>
          {unread ? <span className={styles.dot} aria-hidden /> : null}
          <span className={styles.title}>{BUNDLE_TITLES[bundle.category]}</span>
          {unread ? <span className={clsx("t-data", styles.count)}>{bundle.unreadCount} new</span> : null}
          <span className={styles.spacer} />
          <span className={clsx("t-data", styles.time)}>{formatListTime(bundle.lastDate, now)}</span>
          <ChevronRight size={12} strokeWidth={1.5} color="var(--fg-3)" aria-hidden />
        </div>
        {!compact && first ? (
          <div className={clsx(styles.line)}>
            <span className={styles.latest}><b>{displayName(first.from)}</b> {first.subject}</span>
          </div>
        ) : null}
      </div>
      {onTriage ? (
        <div className={styles.actions} aria-hidden onClick={(e) => e.stopPropagation()}>
          {unread ? (
            <IconButton size={24} tabIndex={-1} label="Mark all as read" onClick={() => onTriage(bundle, "read")}><MailOpen size={14} strokeWidth={1.5} /></IconButton>
          ) : null}
          <IconButton size={24} tabIndex={-1} label="Archive all" onClick={() => onTriage(bundle, "archive")}><Archive size={14} strokeWidth={1.5} /></IconButton>
        </div>
      ) : null}
    </div>
  );
}

export const BundleRow = memo(BundleRowImpl);
