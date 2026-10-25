import { useMemo } from "react";
import { Archive, Clock, Folder, FolderInput, Forward, Home, Inbox, Keyboard, Mail, PenSquare, Pin, RefreshCw, Reply, ReplyAll, Search, Settings, Trash2 } from "lucide-react";
import { flint } from "../../lib/api";
import { Picker, type PickerItem } from "../../shell/Picker";
import type { AppCommands } from "../../shell/useAppCommands";
import { useApp } from "../../state/AppContext";
import { navStore, type NavTarget } from "../../state/nav";
import { moreFolders } from "../../state/sidebarModel";

type Command = PickerItem & { run: () => void };
const I = { size: 14, strokeWidth: 1.5 } as const;

const GO: { label: string; target: NavTarget; shortcut?: string }[] = [
  { label: "Home", target: { view: "home" }, shortcut: "g h" },
  { label: "Inbox", target: { view: "inbox" }, shortcut: "g i" },
  { label: "Agent Activity", target: { view: "agent_activity" } },
  { label: "Pins", target: { view: "pinned" }, shortcut: "g p" },
  { label: "Drafts", target: { view: "drafts" }, shortcut: "g d" },
  { label: "Sent", target: { view: "sent" }, shortcut: "g s" },
  { label: "Scheduled", target: { view: "scheduled" } },
  { label: "Snoozed", target: { view: "snoozed" } },
  { label: "Trash", target: { view: "trash" } },
  { label: "Archive", target: { view: "archive" } },
  { label: "Blocked", target: { view: "blocked" } },
  { label: "Read Statuses", target: { view: "receipts" } },
];

export function CommandPalette({ cmds }: { cmds: AppCommands }) {
  const { accounts, sidebar, settings } = useApp();

  const commands = useMemo<Command[]>(() => {
    const n = navStore.getState();
    const mail = cmds.inMailView();
    const action = (id: string, label: string, icon: React.ReactNode, run: () => void, shortcut?: string, keywords?: string): Command => ({ id, label, icon, run, shortcut, keywords, group: "Actions" });
    const out: Command[] = [];
    if (mail) {
      out.push(
        action("archive", "Archive", <Archive {...I} />, cmds.archive, "e", "done"),
        action("trash", "Move to Trash", <Trash2 {...I} />, cmds.trash, "#", "delete"),
        action("pin", "Pin or unpin", <Pin {...I} />, cmds.togglePin, "s"),
        action("snooze", "Snooze", <Clock {...I} />, cmds.snooze, "h", "later remind"),
        action("move", "Move to folder", <FolderInput {...I} />, cmds.move, "v", "label"),
        action("read", "Mark read or unread", <Mail {...I} />, cmds.toggleRead, "u"),
        action("reply", "Reply", <Reply {...I} />, () => cmds.reply("reply"), "r"),
        action("replyAll", "Reply all", <ReplyAll {...I} />, () => cmds.reply("replyAll"), "a"),
        action("forward", "Forward", <Forward {...I} />, () => cmds.reply("forward"), "f"),
        action("mute", "Mute conversation", <Mail {...I} />, cmds.toggleMute, "m"),
        action("spam", "Mark as spam", <Mail {...I} />, cmds.spam, "!", "junk"),
      );
    }
    out.push(
      { ...action("compose", "New message", <PenSquare {...I} />, cmds.compose, "c", "write email"), group: "App" },
      { ...action("search", "Search mail", <Search {...I} />, () => n.openSearch(), "/", "find"), group: "App" },
      { ...action("sync", "Sync now", <RefreshCw {...I} />, () => void flint.syncNow()), group: "App" },
      { ...action("sidebar", "Show or hide sidebar", <Home {...I} />, cmds.toggleSidebar, "mod+\\"), group: "App" },
      { ...action("focused", settings.inbox.focused ? "Turn Focused inbox off" : "Turn Focused inbox on", <Inbox {...I} />, cmds.toggleFocused, undefined, "smart"), group: "App" },
      { ...action("split", "Split layout", <Home {...I} />, () => cmds.setLayout("split"), undefined, "panes"), group: "App" },
      { ...action("full", "Full screen layout", <Home {...I} />, () => cmds.setLayout("full"), undefined, "single"), group: "App" },
      { ...action("settings", "Settings", <Settings {...I} />, () => n.openSettings(), "mod+,", "preferences"), group: "App" },
      { ...action("agents", "AI Agents", <Settings {...I} />, () => n.openSettings("agents"), undefined, "cli"), group: "App" },
      { ...action("shortcuts", "Keyboard shortcuts", <Keyboard {...I} />, () => n.showOverlay("shortcuts"), "?", "keys help"), group: "App" },
    );
    for (const g of GO) {
      out.push({ id: `go:${g.label}`, label: g.label, group: "Go to", icon: <Inbox {...I} />, shortcut: g.shortcut, run: () => n.go(g.target) });
    }
    if (accounts.length > 1) {
      accounts.forEach((a, i) =>
        out.push({ id: `acct:${a.id}`, label: `Inbox: ${a.email}`, group: "Go to", icon: <Inbox {...I} />, shortcut: i < 9 ? `mod+${i + 1}` : undefined, run: () => n.go({ view: "inbox", accountId: a.id }, a.email) }),
      );
    }
    for (const a of sidebar?.accounts ?? []) {
      for (const f of moreFolders(a.folders)) {
        out.push({
          id: `folder:${f.id}`,
          label: f.name,
          hint: accounts.length > 1 ? a.account.email : undefined,
          group: "Folders",
          icon: <Folder {...I} />,
          run: () => n.go({ view: "folder", accountId: f.accountId, folderId: f.id }, f.name),
        });
      }
    }
    return out;
  }, [cmds, accounts, sidebar, settings.inbox.focused]);

  const close = () => navStore.getState().closeOverlay();
  return (
    <Picker
      label="Command palette"
      placeholder="Type a command or folder"
      items={commands}
      onClose={close}
      onPick={(item) => {
        close();
        (item as Command).run();
      }}
    />
  );
}
