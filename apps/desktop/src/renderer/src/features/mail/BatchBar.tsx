import { Archive, Clock, FolderInput, Mail, MailOpen, Pin, Trash2, X } from "lucide-react";
import { IconButton } from "../../ui";
import { PaneHeader } from "../../shell/PaneHeader";
import { useList } from "../../state/listStore";
import { navStore, useNav } from "../../state/nav";
import { useThreadActions } from "../../state/useActions";
import { openMovePicker, openSnooze } from "./mailCommands";

/** Replaces the list header while two or more threads are selected. */
export function BatchBar() {
  const selected = useNav((s) => s.selected);
  const raw = useList((s) => s.raw);
  const { run } = useThreadActions();
  const items = raw.filter((i) => selected.includes(i.id));
  const anyUnread = items.some((i) => i.unreadCount > 0);
  const allPinned = items.length > 0 && items.every((i) => i.pinned);
  const icon = { size: 16, strokeWidth: 1.5 } as const;

  return (
    <PaneHeader title={`${selected.length} selected`}>
      <IconButton label="Archive" shortcut="e" onClick={() => void run({ type: "archive" }, selected)}><Archive {...icon} /></IconButton>
      <IconButton label="Trash" shortcut="#" onClick={() => void run({ type: "trash" }, selected)}><Trash2 {...icon} /></IconButton>
      <IconButton label={allPinned ? "Unpin" : "Pin"} shortcut="s" onClick={() => void run({ type: "pin", pinned: !allPinned }, selected)}><Pin {...icon} /></IconButton>
      <IconButton label={anyUnread ? "Mark as read" : "Mark as unread"} shortcut="u" onClick={() => void run({ type: "read", read: anyUnread }, selected)}>
        {anyUnread ? <MailOpen {...icon} /> : <Mail {...icon} />}
      </IconButton>
      <IconButton label="Snooze" shortcut="h" onClick={() => openSnooze(selected)}><Clock {...icon} /></IconButton>
      <IconButton label="Move to folder" shortcut="v" onClick={() => openMovePicker(selected)}><FolderInput {...icon} /></IconButton>
      <IconButton label="Clear selection" shortcut="Escape" onClick={() => navStore.getState().clearSelected()}><X {...icon} /></IconButton>
    </PaneHeader>
  );
}
