import { memo, type DragEvent, type MouseEvent } from "react";
import { Archive, BellRing, Clock, Paperclip, Pin, PinOff, Trash2 } from "lucide-react";
import clsx from "clsx";
import type { ThreadListItem } from "@flint/core";
import { Avatar, Checkbox, CountChip, IconButton } from "../../ui";
import { receiptMarker } from "../../state/receiptText";
import { ReceiptCheck } from "../receipts/ReceiptCheck";
import { CodeChip } from "../codes/CodeChip";
import { InviteChip } from "./invite/InviteChip";
import { rowAvatar, rowSender, rowTime } from "./rowText";
import styles from "./ThreadRow.module.css";

/** DOM id of a list row, from its row key ("t12", "b:newsletters"): the listbox names its active option with it. */
export const rowDomId = (key: string): string => `row-${key}`;

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
  /** Some row is checked: every avatar shows its checkbox. */
  selecting?: boolean;
  now: number;
  onSelect: (item: ThreadListItem, e: MouseEvent) => void;
  onCheck?: (item: ThreadListItem) => void;
  onDragStart?: (item: ThreadListItem, e: DragEvent) => void;
  onPin: (item: ThreadListItem) => void;
  onArchive: (item: ThreadListItem) => void;
  onTrash: (item: ThreadListItem) => void;
  onSnooze: (item: ThreadListItem) => void;
};

function ThreadRowImpl({ item, compact, previewLines, avatars, accountColor, open, cursor, checked, selecting = false, now, onSelect, onCheck, onDragStart, onPin, onArchive, onTrash, onSnooze }: ThreadRowProps) {
  const unread = item.unreadCount > 0;
  const sender = rowSender(item);
  const lead = rowAvatar(item);
  const time = rowTime(item, now);
  const marker = item.receipt ? receiptMarker(item.receipt) : null;
  const showPreview = !compact && previewLines > 0;

  return (
    <div
      role="option"
      id={rowDomId(`t${item.id}`)}
      aria-selected={open || checked}
      data-thread-id={item.id}
      draggable={onDragStart ? true : undefined}
      onDragStart={onDragStart ? (e) => onDragStart(item, e) : undefined}
      className={clsx(styles.row, "t-body", compact && styles.compact, unread && styles.unread, (open || checked) && styles.selected, !open && !checked && cursor && styles.cursor, (selecting || checked) && styles.selecting)}
      onClick={(e) => onSelect(item, e)}
    >
      {unread ? <span className="sr-only">Unread</span> : null}
      {avatars ? (
        <span className={clsx(styles.lead, compact ? styles.lead24 : styles.lead32)}>
          <Avatar className={styles.avatar} address={lead.address} name={lead.name} size={compact ? 24 : 32} />
          {onCheck ? (
            <span className={styles.check} onClick={(e) => e.stopPropagation()}>
              <Checkbox checked={checked} onChange={() => onCheck(item)} ariaLabel={`Select ${item.subject || "(no subject)"}`} />
            </span>
          ) : null}
        </span>
      ) : null}
      <div className={styles.body}>
        <div className={styles.line}>
          {/* Absolutely placed at the row's left gutter; the line's centring puts it on line 1 at every density. */}
          {unread ? <span className={styles.dot} aria-hidden /> : null}
          <span className={styles.sender}>
            {sender.draft ? <span className={styles.draftTag}>Draft{sender.text ? ", " : ""}</span> : null}
            {sender.text}
          </span>
          <span className={clsx(styles.meta, "t-data")}>
            {item.muted ? <BellRing size={12} strokeWidth={1.5} role="img" aria-label="Muted" /> : null}
            {item.pinned ? <Pin size={12} strokeWidth={1.5} className={styles.pin} role="img" aria-label="Pinned" /> : null}
            {marker ? (
              <ReceiptCheck marker={marker} className={styles.receipt} />
            ) : null}
            <span className={styles.time}>
              {time.snoozed ? <Clock size={12} strokeWidth={1.5} className={styles.snoozed} aria-hidden /> : null}
              {time.text}
            </span>
          </span>
        </div>
        <div className={styles.line}>
          <span className={styles.subject}>{item.subject || "(no subject)"}</span>
          <span className={styles.tail}>
            <InviteChip invite={item.invite} now={now} />
            <CodeChip badge={item.verificationCode} />
            {item.messageCount > 1 ? <CountChip count={item.messageCount} /> : null}
            {item.hasAttachments ? <Paperclip size={12} strokeWidth={1.5} role="img" aria-label="Has attachments" /> : null}
            {accountColor ? <span className={styles.acct} style={{ background: accountColor }} aria-hidden /> : null}
          </span>
        </div>
        {showPreview ? <div className={clsx(styles.preview, previewLines === 2 && styles.preview2)}>{item.snippet}</div> : null}
      </div>
      {/* Mouse shortcuts for actions the keyboard and the row menu already offer, so screen readers skip them. */}
      <div className={styles.actions} aria-hidden onClick={(e) => e.stopPropagation()}>
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
