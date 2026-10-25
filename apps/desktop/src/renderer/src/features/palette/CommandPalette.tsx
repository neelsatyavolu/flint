import { useMemo } from "react";
import { Activity, Archive, BellOff, Ban, CalendarClock, Clock, Eye, FileText, Folder, FolderInput, Forward, Home, Inbox, Keyboard, Mail, PanelLeft, PenSquare, Pin, RefreshCw, Reply, ReplyAll, Search, Send, Settings, ShieldAlert, Sparkles, Trash2, Columns2, Maximize2 } from "lucide-react";
import { flint } from "../../lib/api";
import { Picker, type PickerItem } from "../../shell/Picker";
import type { AppCommands } from "../../shell/useAppCommands";
import { useApp } from "../../state/AppContext";
import { navStore, type NavTarget } from "../../state/nav";
import { moreFolders } from "../../state/sidebarModel";
import { CATEGORY_TITLES } from "../../state/viewMeta";

type Command = PickerItem & { run: () => void };
const I = { size: 14, strokeWidth: 1.5 } as const;

const GO: { label: string; target: NavTarget; icon: React.ReactNode; shortcut?: string }[] = [
  { label: "Home", target: { view: "home" }, icon: <Home {...I} />, shortcut: "g h" },
  { label: "Inbox", target: { view: "inbox" }, icon: <Inbox {...I} />, shortcut: "g i" },
  { label: "Agent Activity", target: { view: "agent_activity" }, icon: <Activity {...I} /> },
  { label: "Pins", target: { view: "pinned" }, icon: <Pin {...I} />, shortcut: "g p" },
  { label: "Drafts", target: { view: "drafts" }, icon: <FileText {...I} />, shortcut: "g d" },
  { label: "Sent", target: { view: "sent" }, icon: <Send {...I} />, shortcut: "g s" },
  { label: "Scheduled", target: { view: "scheduled" }, icon: <CalendarClock {...I} /> },
  { label: "Snoozed", target: { view: "snoozed" }, icon: <Clock {...I} /> },
  { label: "Trash", target: { view: "trash" }, icon: <Trash2 {...I} /> },
  { label: "Archive", target: { view: "archive" }, icon: <Archive {...I} /> },
  { label: "Blocked", target: { view: "blocked" }, icon: <Ban {...I} /> },
  { label: "Read Statuses", target: { view: "receipts" }, icon: <Eye {...I} /> },
];

export function CommandPalette({ cmds }: { cmds: AppCommands }) {
  const { accounts, sidebar, settings } = useApp();

  const commands = useMemo<Command[]>(() => {
    const n = navStore.getState();
    const mail = cmds.inMailView() && cmds.hasTarget();
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
        action("mute", "Mute conversation", <BellOff {...I} />, cmds.toggleMute, "m"),
        ...(["people", "notifications", "newsletters"] as const)
          .filter((c) => c !== cmds.targetCategory())
          .map((c) => action(`category-${c}`, `Move to ${CATEGORY_TITLES[c]}`, <Mail {...I} />, () => cmds.setCategory(c), undefined, "category recategorize file")),
        action("spam", "Mark as spam", <ShieldAlert {...I} />, cmds.spam, "!", "junk"),
      );
    }
    out.push(
      { ...action("compose", "New message", <PenSquare {...I} />, cmds.compose, "c", "write email"), group: "App" },
      { ...action("search", "Search mail", <Search {...I} />, () => n.openSearch(), "/", "find"), group: "App" },
      { ...action("sync", "Sync now", <RefreshCw {...I} />, () => void flint.syncNow()), group: "App" },
      { ...action("sidebar", "Show or hide sidebar", <PanelLeft {...I} />, cmds.toggleSidebar, "mod+\\"), group: "App" },
      { ...action("focused", settings.inbox.focused ? "Turn Focused inbox off" : "Turn Focused inbox on", <Inbox {...I} />, cmds.toggleFocused, undefined, "smart"), group: "App" },
      { ...action("split", "Split layout", <Columns2 {...I} />, () => cmds.setLayout("split"), undefined, "panes"), group: "App" },
      { ...action("full", "Full screen layout", <Maximize2 {...I} />, () => cmds.setLayout("full"), undefined, "single"), group: "App" },
      { ...action("settings", "Settings", <Settings {...I} />, () => n.openSettings(), "mod+,", "preferences"), group: "App" },
      { ...action("agents", "AI Agents", <Sparkles {...I} />, () => n.openSettings("agents"), undefined, "cli"), group: "App" },
      { ...action("shortcuts", "Keyboard shortcuts", <Keyboard {...I} />, () => n.showOverlay("shortcuts"), "?", "keys help"), group: "App" },
    );
    for (const g of GO) {
      out.push({ id: `go:${g.label}`, label: g.label, group: "Go to", icon: g.icon, shortcut: g.shortcut, run: () => n.go(g.target) });
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
