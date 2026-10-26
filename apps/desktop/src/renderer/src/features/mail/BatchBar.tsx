import { Archive, Clock, FolderInput, Inbox, Mail, MailOpen, MoreHorizontal, Pin, ShieldCheck, Trash2, X } from "lucide-react";
import { IconButton, Menu } from "../../ui";
import type { MenuItem } from "../../ui";
import { PaneHeader } from "../../shell/PaneHeader";
import { useList } from "../../state/listStore";
import { navStore, useNav } from "../../state/nav";
import { useThreadActions } from "../../state/useActions";
import { useToast } from "../../ui/Toast";
import { deleteDraftRow, openMovePicker, openSnooze } from "./mailCommands";
import { OUT_OF_INBOX } from "./ReaderToolbar";
import { categoryMenuItems } from "./rowMenu";

/** Replaces the list header while two or more threads are selected. Its actions follow the view, like the reader's. */
export function BatchBar() {
  const selected = useNav((s) => s.selected);
  const view = useNav((s) => s.view);
  const raw = useList((s) => s.raw);
  const { run } = useThreadActions();
  const toast = useToast();
  const items = raw.filter((i) => selected.includes(i.id));
  const anyUnread = items.some((i) => i.unreadCount > 0);
  const allPinned = items.length > 0 && items.every((i) => i.pinned);
  const categories = new Set(items.map((i) => i.category));
  const icon = { size: 16, strokeWidth: 1.5 } as const;
  const spamView = view === "spam";
  const leaveInbox = OUT_OF_INBOX.has(view);
  const clear = <IconButton label="Clear selection" shortcut="Escape" onClick={() => navStore.getState().clearSelected()}><X {...icon} /></IconButton>;

  // Drafts take only Trash, which deletes local drafts (with Undo) the way # does; server-only drafts go to Trash.
  if (view === "drafts") {
    const trashDrafts = () => {
      const local = items.flatMap((i) => (i.draft?.draftId != null ? [{ row: i.id, draftId: i.draft.draftId }] : []));
      for (const d of local) void deleteDraftRow(d.draftId, toast.show);
      const gone = new Set(local.map((d) => d.row));
      const rest = selected.filter((id) => !gone.has(id));
      navStore.getState().setSelected(rest);
      if (rest.length) void run({ type: "trash" }, rest);
    };
    return (
      <PaneHeader title={`${selected.length} selected`}>
        <IconButton label="Trash" shortcut="#" onClick={trashDrafts}><Trash2 {...icon} /></IconButton>
        {clear}
      </PaneHeader>
    );
  }

  // Spam has "Not spam" up front instead; category moves only make sense for mail headed to the inbox.
  const moreItems: MenuItem[] = spamView
    ? []
    : [
        { id: "spam", label: "Mark as spam", shortcut: "!", onSelect: () => void run({ type: "spam", spam: true }, selected) },
        ...(leaveInbox
          ? []
          : [{ type: "separator", id: "sep-cat" } as MenuItem, ...categoryMenuItems(categories.size === 1 ? [...categories][0]! : null, (action) => void run(action, selected))]),
      ];

  return (
    <PaneHeader title={`${selected.length} selected`}>
      {spamView ? (
        <IconButton label="Not spam" onClick={() => void run({ type: "spam", spam: false }, selected)}><ShieldCheck {...icon} /></IconButton>
      ) : leaveInbox ? (
        <IconButton label="Move to Inbox" onClick={() => void run({ type: "inbox" }, selected)}><Inbox {...icon} /></IconButton>
      ) : (
        <IconButton label="Archive" shortcut="e" onClick={() => void run({ type: "archive" }, selected)}><Archive {...icon} /></IconButton>
      )}
      <IconButton label="Trash" shortcut="#" onClick={() => void run({ type: "trash" }, selected)}><Trash2 {...icon} /></IconButton>
      <IconButton label={allPinned ? "Unpin" : "Pin"} shortcut="s" onClick={() => void run({ type: "pin", pinned: !allPinned }, selected)}><Pin {...icon} /></IconButton>
      <IconButton label={anyUnread ? "Mark as read" : "Mark as unread"} shortcut="u" onClick={() => void run({ type: "read", read: anyUnread }, selected)}>
        {anyUnread ? <MailOpen {...icon} /> : <Mail {...icon} />}
      </IconButton>
      <IconButton label="Snooze" shortcut="h" onClick={() => openSnooze(selected)}><Clock {...icon} /></IconButton>
      <IconButton label="Move to folder" shortcut="v" onClick={() => openMovePicker(selected)}><FolderInput {...icon} /></IconButton>
      {moreItems.length > 0 ? <Menu items={moreItems} placement="bottom-end" trigger={<IconButton label="More"><MoreHorizontal {...icon} /></IconButton>} /> : null}
      {clear}
    </PaneHeader>
  );
}
