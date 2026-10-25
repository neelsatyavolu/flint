export type ShortcutGroup = { title: string; items: { combo: string; label: string }[] };

/** SPEC §11. Combos use the registry format ("mod+k", "g i"). */
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Mail",
    items: [
      { combo: "c", label: "Compose" },
      { combo: "r", label: "Reply" },
      { combo: "a", label: "Reply all" },
      { combo: "f", label: "Forward" },
      { combo: "e", label: "Archive" },
      { combo: "#", label: "Trash" },
      { combo: "Backspace", label: "Trash" },
      { combo: "s", label: "Pin" },
      { combo: "h", label: "Snooze" },
      { combo: "u", label: "Mark read or unread" },
      { combo: "!", label: "Mark as spam" },
      { combo: "m", label: "Mute thread" },
    ],
  },
  {
    title: "Move around",
    items: [
      { combo: "j", label: "Next thread" },
      { combo: "k", label: "Previous thread" },
      { combo: "ArrowDown", label: "Move selection down" },
      { combo: "ArrowUp", label: "Move selection up" },
      { combo: "Enter", label: "Open thread" },
      { combo: "o", label: "Open thread" },
      { combo: "Escape", label: "Back or close" },
      { combo: "/", label: "Search" },
      { combo: "mod+f", label: "Search" },
      { combo: "mod+k", label: "Command palette" },
    ],
  },
  {
    title: "Go to",
    items: [
      { combo: "g i", label: "Inbox" },
      { combo: "g s", label: "Sent" },
      { combo: "g d", label: "Drafts" },
      { combo: "g p", label: "Pins" },
      { combo: "g h", label: "Home" },
      { combo: "mod+1", label: "Inbox of account 1 to 9" },
    ],
  },
  {
    title: "Composer and app",
    items: [
      { combo: "mod+Enter", label: "Send" },
      { combo: "l", label: "Send later (in the composer)" },
      { combo: "mod+shift+z", label: "Undo" },
      { combo: "mod+,", label: "Settings" },
      { combo: "mod+\\", label: "Show or hide the sidebar" },
      { combo: "?", label: "Shortcut sheet" },
    ],
  },
];
