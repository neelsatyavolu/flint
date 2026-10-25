import { memo } from "react";
import { Bell, ChevronRight, Newspaper } from "lucide-react";
import clsx from "clsx";
import type { Bundle } from "@flint/core";
import { formatListTime, displayName } from "../../lib/format";
import styles from "./BundleRow.module.css";

export const BUNDLE_TITLES: Record<Bundle["category"], string> = { notifications: "Notifications", newsletters: "Newsletters" };

type Props = { bundle: Bundle; compact: boolean; cursor: boolean; now: number; onOpen: (b: Bundle) => void };

function BundleRowImpl({ bundle, compact, cursor, now, onOpen }: Props) {
  const Glyph = bundle.category === "notifications" ? Bell : Newspaper;
  const first = bundle.latest[0];
  const unread = bundle.unreadCount > 0;
  return (
    <div role="option" aria-selected={false} data-bundle={bundle.category} className={clsx(styles.row, "t-body", compact && styles.compact, unread && styles.unread, cursor && styles.cursor)} onClick={() => onOpen(bundle)}>
      {unread ? <span className={styles.dot} aria-label="Unread" /> : null}
      <span className={clsx(styles.glyph, compact ? styles.g24 : styles.g32)}><Glyph size={compact ? 13 : 16} strokeWidth={1.5} /></span>
      <div className={styles.body}>
        <div className={styles.line}>
          <span className={styles.title}>{BUNDLE_TITLES[bundle.category]}</span>
          {unread ? <span className={clsx("t-data", styles.count)}>{bundle.unreadCount} new</span> : null}
          <span className={styles.spacer} />
          <span className={clsx("t-data", styles.time)}>{formatListTime(bundle.lastDate, now)}</span>
          <ChevronRight size={14} strokeWidth={1.5} color="var(--fg-3)" />
        </div>
        {!compact && first ? (
          <div className={clsx(styles.line)}>
            <span className={styles.latest}><b>{displayName(first.from)}</b> {first.subject}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const BundleRow = memo(BundleRowImpl);
