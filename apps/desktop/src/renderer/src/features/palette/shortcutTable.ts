export type ShortcutEntry = { combo: string; label: string };
export type ShortcutGroup = { title: string; entries: ShortcutEntry[] };

/**
 * The one shortcut list, shown in the shortcut sheet (?) and in Settings, Shortcuts.
 * Mirrors SPEC section 11, shell/useGlobalShortcuts and the list and composer key handlers.
 */
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Compose",
    entries: [
      { combo: "c", label: "New message" },
      { combo: "r", label: "Reply" },
      { combo: "a", label: "Reply all" },
      { combo: "f", label: "Forward" },
      { combo: "mod+Enter", label: "Send" },
      { combo: "mod+shift+Enter", label: "Send later" },
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
      { combo: "!", label: "Mark as spam or not spam" },
      { combo: "m", label: "Mute" },
      { combo: "mod+z", label: "Undo" },
    ],
  },
  {
    title: "Move around",
    entries: [
      { combo: "j", label: "Next conversation" },
      { combo: "k", label: "Previous conversation" },
      { combo: "Enter", label: "Open" },
      { combo: "x", label: "Select" },
      { combo: "mod+a", label: "Select all" },
      { combo: "shift+u", label: "Unread only" },
      { combo: "shift+F10", label: "Conversation menu" },
      { combo: "Escape", label: "Back or close" },
      { combo: "/", label: "Search" },
      { combo: "mod+k", label: "Command palette" },
      { combo: "F6", label: "Next pane" },
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
      { combo: "mod+p", label: "Print" },
      { combo: "mod+=", label: "Zoom in" },
      { combo: "mod+-", label: "Zoom out" },
      { combo: "mod+0", label: "Actual size" },
      { combo: "mod+,", label: "Settings" },
      { combo: "mod+\\", label: "Show or hide sidebar" },
      { combo: "?", label: "Show shortcuts" },
    ],
  },
];
