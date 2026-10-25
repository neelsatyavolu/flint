import type { MenuItemConstructorOptions } from "electron";

export type MenuSend = (action: string, arg?: string) => void;

/**
 * Native menu. Items send an action string to the renderer through `send`.
 * Single-key shortcuts are shown but not registered (registerAccelerator: false)
 * so the renderer keeps them and typing in fields still works.
 */
export function buildMenuTemplate(opts: { isMac: boolean; isDev: boolean; send: MenuSend; checkForUpdates?: () => void }): MenuItemConstructorOptions[] {
  const { isMac, isDev, send, checkForUpdates } = opts;
  const item = (label: string, action: string, accelerator?: string, display = false): MenuItemConstructorOptions => ({
    label,
    ...(accelerator ? { accelerator } : {}),
    ...(display ? { registerAccelerator: false } : {}),
    click: () => send(action),
  });

  const appMenu: MenuItemConstructorOptions = {
    label: "Flint",
    submenu: [
      { role: "about" },
      ...(checkForUpdates ? [{ label: "Check for Updates...", click: checkForUpdates }] : []),
      { type: "separator" },
      item("Settings...", "settings", "CmdOrCtrl+,"),
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ],
  };

  const file: MenuItemConstructorOptions = {
    label: "File",
    submenu: [item("New Message", "compose", "CmdOrCtrl+N"), { type: "separator" }, { role: "close" }],
  };

  const edit: MenuItemConstructorOptions = {
    label: "Edit",
    submenu: [
      { role: "undo" }, { role: "redo" }, { type: "separator" },
      { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "pasteAndMatchStyle" },
      { role: "delete" }, { role: "selectAll" },
    ],
  };

  const view: MenuItemConstructorOptions = {
    label: "View",
    submenu: [
      item("Toggle Sidebar", "toggle-sidebar", "CmdOrCtrl+\\"),
      { type: "separator" },
      item("Split Layout", "layout:split"),
      item("Full Screen Layout", "layout:full"),
      { type: "separator" },
      { role: "togglefullscreen" },
      ...(isDev
        ? ([
            { type: "separator" },
            { role: "reload", accelerator: "Alt+CmdOrCtrl+R" },
            { role: "toggleDevTools" },
          ] as MenuItemConstructorOptions[])
        : []),
    ],
  };

  const message: MenuItemConstructorOptions = {
    label: "Message",
    submenu: [
      item("Reply", "reply", "CmdOrCtrl+R"),
      item("Reply All", "reply-all", "Shift+CmdOrCtrl+R"),
      item("Forward", "forward", "Shift+CmdOrCtrl+F"),
      { type: "separator" },
      item("Archive", "archive", "E", true),
      item("Trash", "trash", "Backspace", true),
      item("Pin", "pin", "S", true),
      item("Snooze", "snooze", "H", true),
      item("Mark Unread", "mark-unread", "U", true),
    ],
  };

  const go: MenuItemConstructorOptions = {
    label: "Go",
    submenu: [
      item("Inbox", "go:inbox"),
      item("Sent", "go:sent"),
      item("Drafts", "go:drafts"),
      item("Pins", "go:pins"),
      item("Home", "go:home"),
    ],
  };

  const windowMenu: MenuItemConstructorOptions = {
    label: "Window",
    submenu: isMac
      ? [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }]
      : [{ role: "minimize" }, { role: "zoom" }, { role: "close" }],
  };

  const help: MenuItemConstructorOptions = {
    role: "help",
    submenu: [item("Keyboard Shortcuts", "shortcuts")],
  };

  return [...(isMac ? [appMenu] : []), file, edit, view, message, go, windowMenu, help];
}
