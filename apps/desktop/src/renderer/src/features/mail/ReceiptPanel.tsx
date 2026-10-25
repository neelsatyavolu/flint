import { useState } from "react";
import { ChevronRight, Eye } from "lucide-react";
import clsx from "clsx";
import type { ReceiptDetail } from "@flint/core";
import { flint } from "../../lib/api";
import { displayName } from "../../lib/format";
import { SectionLabel, useToast } from "../../ui";
import { RecipientRows } from "../receipts/RecipientRows";
import { eventLine, receiptTime } from "../../state/receiptText";
import styles from "./Message.module.css";

/** Per-recipient read status for a tracked message the user sent, with the event timeline behind a disclosure. */
export function ReceiptPanel({ receipt }: { receipt: ReceiptDetail }) {
  const [open, setOpen] = useState(false);
  const [stopped, setStopped] = useState(false);
  const toast = useToast();
  if (stopped) return null;
  const stop = () =>
    void flint.stopTracking(receipt.trackedId).then(
      () => {
        setStopped(true);
        toast.show({ message: "Stopped tracking this message" });
      },
      () => toast.show({ message: "Couldn't stop tracking. Try again.", level: "error" }),
    );
  return (
    <section className={styles.receipt} aria-label="Read status">
      <SectionLabel className={styles.receiptHead}><Eye size={12} strokeWidth={1.5} /> Read status</SectionLabel>
      <RecipientRows recipients={receipt.recipients} detail={receipt} />
      <div className={styles.receiptFoot}>
        {receipt.events.length ? (
          <button type="button" className={clsx("t-data", styles.disclosure)} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <ChevronRight size={12} strokeWidth={1.5} className={clsx(open && styles.turned)} /> Timeline
          </button>
        ) : null}
        <button type="button" className={clsx("t-data", styles.disclosure)} onClick={stop}>Stop tracking</button>
      </div>
      {open ? (
        <ol className={styles.timeline}>
          {[...receipt.events].sort((a, b) => b.at - a.at).map((ev, i) => (
            <li key={`${ev.at}-${i}`} className={clsx("t-data", styles.event, !ev.counted && styles.dim)}>
              <span className={styles.eventTime}>{receiptTime(ev.at)}</span>
              <span>{displayName({ name: "", address: ev.email })} · {eventLine(ev)}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
