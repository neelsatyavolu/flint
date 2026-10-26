import { memo, useState } from "react";
import { Forward, MoreHorizontal, Reply, ReplyAll } from "lucide-react";
import clsx from "clsx";
import type { MessageView } from "@flint/core";
import { flint } from "../../lib/api";
import { displayName, formatFullDate, formatListTime } from "../../lib/format";
import { Avatar, IconButton, Menu, useToast } from "../../ui";
import type { MenuItem } from "../../ui";
import { useInlineReply } from "../../state/inlineReply";
import type { InlineReplyMode } from "../compose/inlineReplyTypes";
import { AttachmentTiles } from "./AttachmentTiles";
import { MessageBody } from "./MessageBody";
import { useMailAppearance } from "./mailAppearance";
import { ReceiptPanel } from "./ReceiptPanel";
import { ReceiptCheck } from "../receipts/ReceiptCheck";
import { receiptMarker, recipientStatusLine, summaryOf } from "../../state/receiptText";
import { RecipientsLine } from "./RecipientsPopover";
import { PersonCard } from "./PersonCard";
import { blockSender, unsubscribedMessage } from "./blockSender";
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

/** True when a reply would go to one person, so a plain Reply is shown next to Reply all. */
export function hasSingleRecipient(m: MessageView, selfAddresses: string[]): boolean {
  const selves = new Set(selfAddresses.map((s) => s.toLowerCase()));
  const others = new Set([...m.from, ...m.to, ...m.cc].map((a) => a.address.toLowerCase()).filter((a) => !selves.has(a)));
  return others.size <= 1;
}

// Each tracked message you sent carries its own check, so a thread with several of your messages shows each one.
function receiptOf(m: MessageView) {
  return m.receipt
    ? { marker: receiptMarker(summaryOf(m.receipt)), detail: m.receipt.recipients.filter((r) => r.status !== "untracked").map((r) => `${displayName({ name: r.name, address: r.email })}: ${recipientStatusLine(r, m.receipt)}`).join("\n") }
    : null;
}

function MessageItemImpl(props: Props) {
  return props.expanded ? <ExpandedMessage {...props} /> : <CollapsedMessage {...props} />;
}

/** A 48px row. It never touches the mail's HTML, so a long thread's older messages cost nothing to show. */
function CollapsedMessage({ message: m, onToggle, now }: Props) {
  const sender = senderOf(m);
  const name = m.isFromMe ? "me" : displayName(sender);
  const avatar = m.isFromMe ? { accountId: m.accountId } : {};
  const receipt = receiptOf(m);
  return (
    <button type="button" className={clsx(styles.collapsed, !m.seen && styles.unread)} aria-expanded={false} onClick={() => onToggle(m.id)}>
      <Avatar address={sender.address} name={sender.name} size={24} {...avatar} />
      <span className={styles.cName}>{name}</span>
      <span className={styles.cSnippet}>{m.snippet}</span>
      {receipt ? <ReceiptCheck marker={receipt.marker} detail={receipt.detail} /> : null}
      <span className={clsx("t-data", styles.time)}>{formatListTime(m.date, now)}</span>
    </button>
  );
}

function ExpandedMessage({ message: m, selfAddresses, onToggle, onUpdated }: Props) {
  const toast = useToast();
  // "Show original" needs the adapted HTML; work it out only once the ... menu is opened (the body has its own copy).
  const [menuOpened, setMenuOpened] = useState(false);
  const appearance = useMailAppearance(m, menuOpened);
  const sender = senderOf(m);
  const name = m.isFromMe ? "me" : displayName(sender);
  const avatar = m.isFromMe ? { accountId: m.accountId } : {};
  const receipt = receiptOf(m);
  const reply = (mode: InlineReplyMode) => useInlineReply.getState().open({ threadId: m.threadId, messageId: m.id, mode });
  const single = hasSingleRecipient(m, selfAddresses);

  const menu: MenuItem[] = [
    { id: "reply", label: "Reply", shortcut: "r", onSelect: () => reply("reply") },
    { id: "replyAll", label: "Reply all", shortcut: "a", onSelect: () => reply("replyAll") },
    { id: "forward", label: "Forward", shortcut: "f", onSelect: () => reply("forward") },
    { type: "separator", id: "s1" },
    ...(appearance.canToggle
      ? [{ id: "original", label: appearance.showingOriginal ? "Use adapted colors" : "Show original", onSelect: appearance.toggleOriginal } as MenuItem]
      : []),
    {
      id: "unread",
      label: "Mark thread unread",
      onSelect: () =>
        void flint.markRead([m.threadId], false).then(onUpdated, () => toast.show({ message: "Couldn't mark it unread. Try again.", level: "error" })),
    },
    ...(m.unsubscribe ? [{ id: "unsub", label: "Unsubscribe", onSelect: () => void unsubscribe() } as MenuItem] : []),
    ...(!m.isFromMe && sender.address
      ? [{
          id: "block",
          label: "Block sender",
          danger: true,
          onSelect: () => void blockSender(flint, toast, sender.address),
        } as MenuItem]
      : []),
  ];

  async function unsubscribe() {
    try {
      const { method } = await flint.unsubscribe(m.id);
      toast.show({ message: unsubscribedMessage(method) });
    } catch {
      toast.show({ message: "Couldn't unsubscribe. Try again.", level: "error" });
    }
  }

  const act = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <article className={clsx(styles.card, styles.message)} aria-label={`Message from ${name}`} data-message-card>
      <header className={styles.head} onClick={() => onToggle(m.id)}>
        <Avatar address={sender.address} name={sender.name} size={32} className={styles.headAvatar} {...avatar} />
        <div className={styles.headText}>
          {sender.address ? (
            <PersonCard
              person={sender}
              self={m.isFromMe}
              trigger={
                <button type="button" className={clsx("t-strong", styles.fromName)} title={m.isFromMe ? undefined : sender.address} onClick={(e) => e.stopPropagation()} aria-label={`${name}, ${sender.address}. Show card`}>
                  {name}
                </button>
              }
            />
          ) : (
            <span className={clsx("t-strong", styles.fromName)}>{name}</span>
          )}
          <RecipientsLine message={m} selfAddresses={selfAddresses} />
        </div>
        <div className={styles.headRight} onClick={act}>
          {receipt ? <ReceiptCheck marker={receipt.marker} detail={receipt.detail} className={styles.headCheck} /> : null}
          <time className={clsx("t-data", styles.time)} dateTime={new Date(m.date).toISOString()}>{formatFullDate(m.date)}</time>
          <Menu items={menu} placement="bottom-end" trigger={<IconButton size={24} label="More" onPointerDown={() => setMenuOpened(true)} onKeyDown={() => setMenuOpened(true)}><MoreHorizontal size={14} strokeWidth={1.5} /></IconButton>} />
        </div>
      </header>
      <MessageBody message={m} onUpdated={onUpdated} />
      <AttachmentTiles attachments={m.attachments} />
      {m.receipt ? <ReceiptPanel receipt={m.receipt} /> : null}
      <footer className={styles.cardFoot}>
        {single ? <IconButton size={28} label="Reply" shortcut="r" onClick={() => reply("reply")}><Reply size={16} strokeWidth={1.5} /></IconButton> : null}
        <IconButton size={28} label="Reply all" shortcut="a" onClick={() => reply("replyAll")}><ReplyAll size={16} strokeWidth={1.5} /></IconButton>
        <IconButton size={28} label="Forward" shortcut="f" onClick={() => reply("forward")}><Forward size={16} strokeWidth={1.5} /></IconButton>
      </footer>
    </article>
  );
}

export const MessageItem = memo(MessageItemImpl);
