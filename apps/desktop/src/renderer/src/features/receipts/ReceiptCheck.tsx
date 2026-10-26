import { Check, CheckCheck } from "lucide-react";
import clsx from "clsx";
import type { ReceiptMarker } from "../../state/receiptText";
import styles from "./ReceiptCheck.module.css";

/**
 * Read-receipt check for tracked mail you sent: one grey check while no open is known, a green double check once a
 * recipient opened it. With several recipients the count follows ("2/3"). `detail` adds per-recipient lines to the tooltip.
 */
export function ReceiptCheck({ marker, detail, className }: { marker: ReceiptMarker; detail?: string; className?: string }) {
  const Icon = marker.read ? CheckCheck : Check;
  const title = detail ? `${marker.label}\n${detail}` : marker.label;
  return (
    <span className={clsx(styles.check, styles[marker.tone], className)} title={title} aria-label={marker.label} role="img">
      <Icon size={13} strokeWidth={1.75} aria-hidden />
      {marker.text ? <span className={styles.count}>{marker.text}</span> : null}
    </span>
  );
}
