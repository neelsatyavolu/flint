import type { JSX } from "react";
import { Paperclip, X } from "lucide-react";
import type { DraftAttachment } from "@flint/core";
import { formatFileSize } from "../../lib/format";
import styles from "./AttachmentChips.module.css";

type Props = { attachments: DraftAttachment[]; pathless: ReadonlySet<string>; onRemove: (a: DraftAttachment) => void };

export function AttachmentChips({ attachments, pathless, onRemove }: Props): JSX.Element | null {
  if (attachments.length === 0) return null;
  return (
    <ul className={styles.list} aria-label="Attachments">
      {attachments.map((a) => (
        <li key={a.id} className={styles.chip} title={pathless.has(a.filename) ? "Browser preview: only the file name is attached" : a.filename}>
          <Paperclip size={14} strokeWidth={1.5} className={styles.icon} />
          <span className={styles.name}>{a.filename}</span>
          {a.size > 0 ? <span className="t-data" style={{ color: "var(--fg-3)" }}>{formatFileSize(a.size)}</span> : null}
          <button type="button" className={styles.remove} aria-label={`Remove ${a.filename}`} onClick={() => onRemove(a)}>
            <X size={12} strokeWidth={1.5} />
          </button>
        </li>
      ))}
    </ul>
  );
}
