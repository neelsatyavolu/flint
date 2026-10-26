import type { SendResult } from "@flint/core";
import { describeEvent, detectMac, formatCombo } from "../../lib/shortcuts";
import { formatPresetTime } from "../../lib/time";

export type SendToast = { message: string; undoable: boolean; timeoutMs: number };

/** What the toast after Send says: "Sending in 10s", "Scheduled for Tue 8:00 AM" or "Sent". */
export function describeSend(result: SendResult, now: number, scheduledFor?: number): SendToast {
  if (scheduledFor !== undefined) {
    return { message: `Scheduled for ${formatPresetTime(scheduledFor, now)}`, undoable: true, timeoutMs: 8000 };
  }
  const ms = result.undoUntil - now;
  if (ms <= 0) return { message: "Sent", undoable: false, timeoutMs: 3000 };
  return { message: `Sending in ${Math.round(ms / 1000)}s`, undoable: true, timeoutMs: ms };
}

/** The shortcut that undoes a send while its toast is up. mod+shift+z, the app-wide undo, works too. */
export const UNDO_SEND_COMBO = "mod+z";

/** The toast's Undo label with its shortcut, e.g. "Undo ⌘Z". */
export const undoSendLabel = (isMac = detectMac()): string => `Undo ${formatCombo(UNDO_SEND_COMBO, isMac)}`;

/** True for mod+z and mod+shift+z. */
export function isUndoSendKey(e: KeyboardEvent, isMac = detectMac()): boolean {
  const combo = describeEvent(e, isMac);
  return combo === "mod+z" || combo === "mod+shift+z";
}
