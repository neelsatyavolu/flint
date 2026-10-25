import { openComposer } from "../features/compose/composerStore";
import { navStore } from "../state/nav";
import type { AppCommands } from "./useAppCommands";

/** Handles an action string from the native menu or a mailto link. Returns false for unknown actions. */
export function handleMenuAction(action: string, arg: string | undefined, cmds: AppCommands): boolean {
  const nav = navStore.getState();
  switch (action) {
    case "settings": nav.openSettings(); return true;
    case "compose":
      if (arg) openComposer({ mode: "new", to: [{ name: "", address: arg }] });
      else cmds.compose();
      return true;
    case "toggle-sidebar": cmds.toggleSidebar(); return true;
    case "layout:split": cmds.setLayout("split"); return true;
    case "layout:full": cmds.setLayout("full"); return true;
    case "reply": cmds.reply("reply"); return true;
    case "reply-all": cmds.reply("replyAll"); return true;
    case "forward": cmds.reply("forward"); return true;
    case "archive": cmds.archive(); return true;
    case "trash": cmds.trash(); return true;
    case "pin": cmds.togglePin(); return true;
    case "snooze": cmds.snooze(); return true;
    case "mark-unread": cmds.toggleRead(); return true;
    case "shortcuts": nav.showOverlay("shortcuts"); return true;
    case "go:inbox": nav.go({ view: "inbox" }); return true;
    case "go:sent": nav.go({ view: "sent" }); return true;
    case "go:drafts": nav.go({ view: "drafts" }); return true;
    case "go:pins": nav.go({ view: "pinned" }); return true;
    case "go:home": nav.go({ view: "home" }); return true;
    default: return false;
  }
}
