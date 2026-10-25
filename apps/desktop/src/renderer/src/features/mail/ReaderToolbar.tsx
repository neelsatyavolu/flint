import { Archive, ArrowLeft, Clock, FolderInput, Forward, Inbox, Mail, MoreHorizontal, Pin, PinOff, Reply, ReplyAll, Trash2 } from "lucide-react";
import type { ThreadDetail } from "@flint/core";
import { flint } from "../../lib/api";
import { IconButton, Menu, useToast } from "../../ui";
import type { MenuItem } from "../../ui";
import { useApp } from "../../state/AppContext";
import { navStore, useNav } from "../../state/nav";
import { useThreadActions } from "../../state/useActions";
import { replyTarget, composeFor, type ReplyMode } from "../../state/compose";
import { openMovePicker, openSnooze } from "./mailCommands";
import styles from "./Reader.module.css";

const ICON = { size: 18, strokeWidth: 1.5 } as const;
const OUT_OF_INBOX = new Set(["archive", "trash", "spam", "blocked", "folder"]);

export function ReaderToolbar({ thread }: { thread: ThreadDetail | undefined }) {
  const { settings } = useApp();
  const view = useNav((s) => s.view);
  const { run } = useThreadActions();
  const toast = useToast();
  const full = settings.appearance.layout === "full";
  const id = thread?.id;
  const ids = id === undefined ? [] : [id];
  const target = thread ? replyTarget(thread.messages) : undefined;
  const reply = (mode: ReplyMode) => target && composeFor(target, mode);
  const leaveInbox = OUT_OF_INBOX.has(view);
  const sender = thread?.messages.findLast((m) => !m.isFromMe)?.from[0];

  const moreItems: MenuItem[] = thread
    ? [
        { id: "mute", label: thread.muted ? "Unmute" : "Mute", shortcut: "m", onSelect: () => void run({ type: "mute", muted: !thread.muted }, ids) },
        { id: "spam", label: "Mark as spam", shortcut: "!", onSelect: () => void run({ type: "spam", spam: true }, ids) },
        ...(sender
          ? [
              { type: "separator", id: "sep" } as MenuItem,
              view === "blocked"
                ? ({ id: "unblock", label: "Unblock sender", onSelect: () => void flint.unblockSender(sender.address).then(() => toast.show({ message: `Unblocked ${sender.address}` })) } as MenuItem)
                : ({ id: "block", label: "Block sender", danger: true, onSelect: () => void flint.blockSender(sender.address).then(() => toast.show({ message: `Blocked ${sender.address}` })) } as MenuItem),
            ]
          : []),
      ]
    : [];

  return (
    <div className={`${styles.toolbar} drag`}>
      <div className={`${styles.cluster} no-drag`}>
        {full ? <IconButton label="Back to list" shortcut="Escape" onClick={() => navStore.getState().openThread(null)}><ArrowLeft {...ICON} /></IconButton> : null}
        {leaveInbox ? (
          <IconButton label="Move to Inbox" disabled={!thread} onClick={() => void run({ type: "inbox" }, ids)}><Inbox {...ICON} /></IconButton>
        ) : (
          <IconButton label="Archive" shortcut="e" disabled={!thread} onClick={() => void run({ type: "archive" }, ids)}><Archive {...ICON} /></IconButton>
        )}
        <IconButton label="Trash" shortcut="#" disabled={!thread} onClick={() => void run({ type: "trash" }, ids)}><Trash2 {...ICON} /></IconButton>
        <IconButton label="Move to folder" shortcut="v" disabled={!thread} onClick={() => openMovePicker(ids)}><FolderInput {...ICON} /></IconButton>
        <IconButton label="Snooze" shortcut="h" disabled={!thread} onClick={() => openSnooze(ids)}><Clock {...ICON} /></IconButton>
        <IconButton label={thread?.pinned ? "Unpin" : "Pin"} shortcut="s" disabled={!thread} onClick={() => void run({ type: "pin", pinned: !thread?.pinned }, ids)}>
          {thread?.pinned ? <PinOff {...ICON} /> : <Pin {...ICON} />}
        </IconButton>
        <IconButton label="Mark as unread" shortcut="u" disabled={!thread} onClick={() => void run({ type: "read", read: false }, ids)}><Mail {...ICON} /></IconButton>
      </div>
      <span className={styles.grow} />
      <div className={`${styles.cluster} no-drag`}>
        <IconButton label="Reply" shortcut="r" disabled={!target} onClick={() => reply("reply")}><Reply {...ICON} /></IconButton>
        <IconButton label="Reply all" shortcut="a" disabled={!target} onClick={() => reply("replyAll")}><ReplyAll {...ICON} /></IconButton>
        <IconButton label="Forward" shortcut="f" disabled={!target} onClick={() => reply("forward")}><Forward {...ICON} /></IconButton>
        <Menu items={moreItems} placement="bottom-end" trigger={<IconButton label="More" disabled={!thread}><MoreHorizontal {...ICON} /></IconButton>} />
      </div>
    </div>
  );
}
