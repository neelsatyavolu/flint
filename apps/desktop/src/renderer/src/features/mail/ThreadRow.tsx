import { memo, type MouseEvent } from "react";
import { Archive, BellRing, Clock, Paperclip, Pin, PinOff, Trash2 } from "lucide-react";
import clsx from "clsx";
import type { ThreadListItem } from "@flint/core";
import { Avatar, CountChip, IconButton } from "../../ui";
import { receiptMarker } from "../../state/receiptText";
import { ReceiptCheck } from "../receipts/ReceiptCheck";
import { CodeChip } from "../codes/CodeChip";
import { rowAvatar, rowSender, rowTime } from "./rowText";
import styles from "./ThreadRow.module.css";

export type ThreadRowProps = {
  item: ThreadListItem;
  compact: boolean;
  previewLines: 0 | 1 | 2;
  avatars: boolean;
  /** Account colour dot, shown in the unified inbox when the setting is on. */
  accountColor: string | null;
  open: boolean;
  cursor: boolean;
  checked: boolean;
  now: number;
  onSelect: (item: ThreadListItem, e: MouseEvent) => void;
  onPin: (item: ThreadListItem) => void;
  onArchive: (item: ThreadListItem) => void;
  onTrash: (item: ThreadListItem) => void;
  onSnooze: (item: ThreadListItem) => void;
};

function ThreadRowImpl({ item, compact, previewLines, avatars, accountColor, open, cursor, checked, now, onSelect, onPin, onArchive, onTrash, onSnooze }: ThreadRowProps) {
  const unread = item.unreadCount > 0;
  const sender = rowSender(item);
  const lead = rowAvatar(item);
  const time = rowTime(item, now);
  const marker = item.receipt ? receiptMarker(item.receipt) : null;
  const showPreview = !compact && previewLines > 0;

  return (
    <div
      role="option"
      aria-selected={open || checked}
      data-thread-id={item.id}
      className={clsx(styles.row, "t-body", compact && styles.compact, unread && styles.unread, (open || checked) && styles.selected, !open && !checked && cursor && styles.cursor)}
      onClick={(e) => onSelect(item, e)}
    >
      {unread ? <span className={styles.dot} aria-label="Unread" /> : null}
      {avatars ? <Avatar className={styles.avatar} address={lead.address} name={lead.name} size={compact ? 24 : 32} /> : null}
      <div className={styles.body}>
        <div className={styles.line}>
          <span className={styles.sender}>
            {sender.draft ? <span className={styles.draftTag}>Draft{sender.text ? ", " : ""}</span> : null}
            {sender.text}
          </span>
          <span className={clsx(styles.meta, "t-data")}>
            {item.muted ? <BellRing size={12} strokeWidth={1.5} aria-label="Muted" /> : null}
            {item.pinned ? <Pin size={12} strokeWidth={1.5} className={styles.pin} aria-label="Pinned" /> : null}
            {marker ? (
              <ReceiptCheck marker={marker} className={styles.receipt} />
            ) : null}
            <span className={styles.time}>
              {time.snoozed ? <Clock size={11} strokeWidth={1.5} style={{ marginRight: 4, verticalAlign: -1 }} /> : null}
              {time.text}
            </span>
          </span>
        </div>
        <div className={styles.line}>
          <span className={styles.subject}>{item.subject || "(no subject)"}</span>
          <span className={styles.tail}>
            <CodeChip badge={item.verificationCode} />
            {item.messageCount > 1 ? <CountChip count={item.messageCount} /> : null}
            {item.hasAttachments ? <Paperclip size={13} strokeWidth={1.5} aria-label="Has attachments" /> : null}
            {accountColor ? <span className={styles.acct} style={{ background: accountColor }} aria-hidden /> : null}
          </span>
        </div>
        {showPreview ? <div className={clsx(styles.preview, previewLines === 2 && styles.preview2)}>{item.snippet}</div> : null}
      </div>
      <div className={styles.actions} onClick={(e) => e.stopPropagation()}>
        {item.draft ? (
          <IconButton size={24} tabIndex={-1} label="Delete draft" shortcut="#" onClick={() => onTrash(item)}><Trash2 size={14} strokeWidth={1.5} /></IconButton>
        ) : (
          <>
            <IconButton size={24} tabIndex={-1} label={item.pinned ? "Unpin" : "Pin"} shortcut="s" onClick={() => onPin(item)}>
              {item.pinned ? <PinOff size={14} strokeWidth={1.5} /> : <Pin size={14} strokeWidth={1.5} />}
            </IconButton>
            <IconButton size={24} tabIndex={-1} label="Archive" shortcut="e" onClick={() => onArchive(item)}><Archive size={14} strokeWidth={1.5} /></IconButton>
            <IconButton size={24} tabIndex={-1} label="Trash" shortcut="#" onClick={() => onTrash(item)}><Trash2 size={14} strokeWidth={1.5} /></IconButton>
            <IconButton size={24} tabIndex={-1} label="Snooze" shortcut="h" onClick={() => onSnooze(item)}><Clock size={14} strokeWidth={1.5} /></IconButton>
          </>
        )}
      </div>
    </div>
  );
}

export const ThreadRow = memo(ThreadRowImpl);
