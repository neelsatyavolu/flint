import { memo } from "react";
import { Forward, MoreHorizontal, Reply, ReplyAll } from "lucide-react";
import clsx from "clsx";
import type { MessageView } from "@flint/core";
import { flint } from "../../lib/api";
import { displayName, formatFullDate, formatListTime, formatRecipients } from "../../lib/format";
import { Avatar, IconButton, Menu, useToast } from "../../ui";
import type { MenuItem } from "../../ui";
import { composeFor } from "../../state/compose";
import { AttachmentTiles } from "./AttachmentTiles";
import { MessageBody } from "./MessageBody";
import { ReceiptPanel } from "./ReceiptPanel";
import styles from "./Message.module.css";

type Props = {
  message: MessageView;
  expanded: boolean;
  selfAddresses: string[];
  onToggle: (id: number) => void;
  onUpdated: () => void;
  now: number;
};

function senderOf(m: MessageView) {
  return m.from[0] ?? { name: "", address: "" };
}

function MessageItemImpl({ message: m, expanded, selfAddresses, onToggle, onUpdated, now }: Props) {
  const toast = useToast();
  const sender = senderOf(m);
  const name = m.isFromMe ? "me" : displayName(sender);

  if (!expanded) {
    return (
      <button type="button" className={clsx(styles.collapsed, !m.seen && styles.unread)} aria-expanded={false} onClick={() => onToggle(m.id)}>
        <Avatar address={sender.address} name={sender.name} size={24} />
        <span className={styles.cName}>{name}</span>
        <span className={styles.cSnippet}>{m.snippet}</span>
        <span className={clsx("t-data", styles.time)}>{formatListTime(m.date, now)}</span>
      </button>
    );
  }

  const cc = m.cc.length ? `, cc ${m.cc.map((a) => displayName(a)).join(", ")}` : "";
  const moreItems: MenuItem[] = [
    ...(m.unsubscribe
      ? [{ id: "unsub", label: "Unsubscribe", onSelect: () => void unsubscribe() } as MenuItem]
      : []),
    ...(!m.isFromMe && sender.address
      ? [{
          id: "block",
          label: "Block sender",
          danger: true,
          onSelect: () =>
            void flint.blockSender(sender.address).then(
              () => toast.show({ message: `Blocked ${sender.address}` }),
              () => toast.show({ message: "Couldn't block that sender. Try again.", level: "error" }),
            ),
        } as MenuItem]
      : []),
  ];

  async function unsubscribe() {
    try {
      const { method } = await flint.unsubscribe(m.id);
      toast.show({ message: method === "browser" ? "Opened the unsubscribe page" : method === "mailto" ? "Sent an unsubscribe email" : "Unsubscribed" });
    } catch {
      toast.show({ message: "Couldn't unsubscribe. Try again.", level: "error" });
    }
  }

  const act = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <article className={styles.message} aria-label={`Message from ${name}`}>
      <header className={styles.head} onClick={() => onToggle(m.id)}>
        <Avatar address={sender.address} name={sender.name} size={32} className={styles.headAvatar} />
        <div className={styles.headText}>
          <div className={styles.fromLine}>
            <span className={clsx("t-strong", styles.fromName)}>{name}</span>
            {!m.isFromMe && sender.address ? <span className={styles.fromAddr}>{sender.address}</span> : null}
          </div>
          <div className={styles.toLine}>{formatRecipients(m.to, selfAddresses)}{cc}</div>
        </div>
        <div className={styles.headRight} onClick={act}>
          <span className={styles.hoverActions}>
            <IconButton size={24} label="Reply" shortcut="r" onClick={() => composeFor(m, "reply")}><Reply size={14} strokeWidth={1.5} /></IconButton>
            <IconButton size={24} label="Reply all" shortcut="a" onClick={() => composeFor(m, "replyAll")}><ReplyAll size={14} strokeWidth={1.5} /></IconButton>
            <IconButton size={24} label="Forward" shortcut="f" onClick={() => composeFor(m, "forward")}><Forward size={14} strokeWidth={1.5} /></IconButton>
            {moreItems.length ? (
              <Menu items={moreItems} placement="bottom-end" trigger={<IconButton size={24} label="More"><MoreHorizontal size={14} strokeWidth={1.5} /></IconButton>} />
            ) : null}
          </span>
          <time className={clsx("t-data", styles.time)} dateTime={new Date(m.date).toISOString()}>{formatFullDate(m.date)}</time>
        </div>
      </header>
      <MessageBody message={m} onUpdated={onUpdated} />
      <AttachmentTiles attachments={m.attachments} />
      {m.receipt ? <ReceiptPanel receipt={m.receipt} /> : null}
    </article>
  );
}

export const MessageItem = memo(MessageItemImpl);
