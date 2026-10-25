import clsx from "clsx";
import type { ReceiptDetail, ReceiptRecipient } from "@flint/core";
import { displayName } from "../../lib/format";
import { Avatar } from "../../ui";
import { receiptTone, recipientStatusLine } from "../../state/receiptText";
import styles from "./RecipientRows.module.css";

const TONE = { ok: styles.ok, warn: styles.warn, muted: styles.muted } as const;

/** One line per recipient: avatar, name, and an honest status ("Opened 3:52 PM · Gmail · San Jose"). */
export function RecipientRows({ recipients, detail }: { recipients: ReceiptRecipient[]; detail?: ReceiptDetail | null }) {
  return (
    <ul className={styles.list}>
      {recipients.map((r) => (
        <li key={r.email} className={styles.row}>
          <Avatar address={r.email} name={r.name} size={16} />
          <span className={styles.name}>{displayName({ name: r.name, address: r.email })}</span>
          <span className={clsx("t-data", styles.status, TONE[receiptTone(r.status)])} title={r.status === "sent" ? "Images may be blocked or cached (Gmail, Outlook), so an open can go undetected." : undefined}>
            <span className={styles.dot} aria-hidden />
            <span className={styles.text}>{recipientStatusLine(r, detail)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
