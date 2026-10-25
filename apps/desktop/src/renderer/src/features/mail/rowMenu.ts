import type { MenuItem } from "../../ui";
import type { ThreadListItem } from "@flint/core";
import type { ThreadAction } from "../../state/actions";

type Handlers = {
  run: (action: ThreadAction, ids: number[]) => void;
  snooze: (ids: number[]) => void;
  move: (ids: number[]) => void;
  reply: (item: ThreadListItem, mode: "reply" | "replyAll" | "forward") => void;
  block: (item: ThreadListItem) => void;
  /** Drafts view. */
  openDraft?: (item: ThreadListItem) => void;
  deleteDraft?: (item: ThreadListItem) => void;
};

/** Right-click menu for a row. `ids` is the multi-selection when the row is part of it, else just this row. */
export function rowMenuItems(item: ThreadListItem, ids: number[], h: Handlers, inInboxLike: boolean): MenuItem[] {
  if (item.draft && h.openDraft && h.deleteDraft) {
    const { openDraft, deleteDraft } = h;
    return [
      { id: "open", label: "Open draft", shortcut: "↵", onSelect: () => openDraft(item) },
      { id: "delete", label: "Delete draft", shortcut: "#", danger: true, onSelect: () => deleteDraft(item) },
    ];
  }
  const many = ids.length > 1;
  const subject = many ? ` (${ids.length})` : "";
  const items: MenuItem[] = [];
  if (!many) {
    items.push(
      { id: "reply", label: "Reply", shortcut: "r", onSelect: () => h.reply(item, "reply") },
      { id: "replyAll", label: "Reply all", shortcut: "a", onSelect: () => h.reply(item, "replyAll") },
      { id: "forward", label: "Forward", shortcut: "f", onSelect: () => h.reply(item, "forward") },
      { type: "separator", id: "s1" },
    );
  }
  items.push(
    inInboxLike
      ? { id: "archive", label: `Archive${subject}`, shortcut: "e", onSelect: () => h.run({ type: "archive" }, ids) }
      : { id: "inbox", label: `Move to Inbox${subject}`, onSelect: () => h.run({ type: "inbox" }, ids) },
    { id: "trash", label: `Move to Trash${subject}`, shortcut: "#", danger: true, onSelect: () => h.run({ type: "trash" }, ids) },
    { id: "pin", label: item.pinned ? "Unpin" : "Pin", shortcut: "s", onSelect: () => h.run({ type: "pin", pinned: !item.pinned }, ids) },
    { id: "read", label: item.unreadCount > 0 ? "Mark as read" : "Mark as unread", shortcut: "u", onSelect: () => h.run({ type: "read", read: item.unreadCount > 0 }, ids) },
    { id: "snooze", label: "Snooze…", shortcut: "h", onSelect: () => h.snooze(ids) },
    { id: "move", label: "Move to…", shortcut: "v", onSelect: () => h.move(ids) },
    { type: "separator", id: "s2" },
    { id: "mute", label: item.muted ? "Unmute" : "Mute", shortcut: "m", onSelect: () => h.run({ type: "mute", muted: !item.muted }, ids) },
    { id: "spam", label: "Mark as spam", shortcut: "!", onSelect: () => h.run({ type: "spam", spam: true }, ids) },
  );
  if (!many) items.push({ id: "block", label: "Block sender", onSelect: () => h.block(item) });
  return items;
}
