import { CommandPalette } from "../features/palette/CommandPalette";
import { MovePicker } from "../features/palette/MovePicker";
import { ShortcutSheet } from "../features/palette/ShortcutSheet";
import { useNav } from "../state/nav";
import type { AppCommands } from "./useAppCommands";
import { SnoozeOverlay } from "./SnoozeOverlay";

/** Whichever global overlay is open: palette, snooze, move picker or shortcut sheet. */
export function Overlays({ cmds }: { cmds: AppCommands }) {
  const overlay = useNav((s) => s.overlay);
  switch (overlay) {
    case "palette": return <CommandPalette cmds={cmds} />;
    case "snooze": return <SnoozeOverlay />;
    case "move": return <MovePicker />;
    case "shortcuts": return <ShortcutSheet />;
    default: return null;
  }
}
