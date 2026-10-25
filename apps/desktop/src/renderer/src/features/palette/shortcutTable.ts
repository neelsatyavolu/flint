export type ShortcutEntry = { combo: string; label: string };
export type ShortcutGroup = { title: string; entries: ShortcutEntry[] };

/** Shown in the shortcut sheet. Mirrors SPEC section 11 and shell/useGlobalShortcuts. */
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Compose",
    entries: [
      { combo: "c", label: "New message" },
      { combo: "r", label: "Reply" },
      { combo: "a", label: "Reply all" },
      { combo: "f", label: "Forward" },
      { combo: "mod+Enter", label: "Send" },
      { combo: "l", label: "Send later (in composer)" },
    ],
  },
  {
    title: "Triage",
    entries: [
      { combo: "e", label: "Archive" },
      { combo: "#", label: "Move to Trash" },
      { combo: "s", label: "Pin or unpin" },
      { combo: "h", label: "Snooze" },
      { combo: "v", label: "Move to folder" },
      { combo: "u", label: "Mark read or unread" },
      { combo: "!", label: "Mark as spam" },
      { combo: "m", label: "Mute" },
      { combo: "mod+shift+z", label: "Undo" },
    ],
  },
  {
    title: "Move around",
    entries: [
      { combo: "j", label: "Next conversation" },
      { combo: "k", label: "Previous conversation" },
      { combo: "Enter", label: "Open" },
      { combo: "x", label: "Select" },
      { combo: "Escape", label: "Back or close" },
      { combo: "/", label: "Search" },
      { combo: "mod+k", label: "Command palette" },
    ],
  },
  {
    title: "Go to",
    entries: [
      { combo: "g h", label: "Home" },
      { combo: "g i", label: "Inbox" },
      { combo: "g s", label: "Sent" },
      { combo: "g d", label: "Drafts" },
      { combo: "g p", label: "Pins" },
      { combo: "mod+1", label: "Account inbox 1 to 9" },
    ],
  },
  {
    title: "App",
    entries: [
      { combo: "mod+,", label: "Settings" },
      { combo: "mod+\\", label: "Show or hide sidebar" },
      { combo: "?", label: "This sheet" },
    ],
  },
];
