import { useState, type JSX } from "react";
import { MailFrame } from "../../ui/MailFrame";
import styles from "./Composer.module.css";

/** Quoted original, collapsed behind a "···" pill. */
export function QuotedPill({ html }: { html: string }): JSX.Element | null {
  const [open, setOpen] = useState(false);
  if (!html.trim()) return null;
  return (
    <div className={styles.quoteWrap}>
      <button type="button" className={styles.pill} aria-expanded={open} aria-label={open ? "Hide quoted text" : "Show quoted text"} onClick={() => setOpen((o) => !o)}>···</button>
      {open ? (
        <div className={styles.quote}>
          <MailFrame html={html} allowRemoteImages={false} padding={12} />
        </div>
      ) : null}
    </div>
  );
}
