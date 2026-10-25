import { Download, File } from "lucide-react";
import type { AttachmentInfo } from "@flint/core";
import { flint } from "../../lib/api";
import { formatFileSize } from "../../lib/format";
import { IconButton, useToast } from "../../ui";
import styles from "./Message.module.css";

export function AttachmentTiles({ attachments }: { attachments: AttachmentInfo[] }) {
  const toast = useToast();
  const files = attachments.filter((a) => !a.inline);
  if (files.length === 0) return null;
  const open = (a: AttachmentInfo) => void flint.openAttachment(a.id).catch(() => toast.show({ message: `Couldn't open ${a.filename}.`, level: "error" }));
  const save = (a: AttachmentInfo) =>
    void flint.saveAttachment(a.id).then(
      () => toast.show({ message: `Saved ${a.filename} to Downloads` }),
      () => toast.show({ message: `Couldn't save ${a.filename}.`, level: "error" }),
    );
  return (
    <ul className={styles.tiles} aria-label="Attachments">
      {files.map((a) => (
        <li key={a.id} className={styles.tile}>
          <button type="button" className={styles.tileMain} onClick={() => open(a)} title={a.filename}>
            <File size={18} strokeWidth={1.5} color="var(--fg-2)" />
            <span className={styles.tileText}>
              <span className={styles.tileName}>{a.filename}</span>
              <span className="t-data" style={{ color: "var(--fg-3)" }}>{formatFileSize(a.size)}</span>
            </span>
          </button>
          <IconButton label="Save" size={24} onClick={() => save(a)}><Download size={14} strokeWidth={1.5} /></IconButton>
        </li>
      ))}
    </ul>
  );
}
