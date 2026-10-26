import type { SendResult } from "@flint/core";
import { describeEvent, detectMac, formatCombo } from "../../lib/shortcuts";
import { formatPresetTime } from "../../lib/time";

/** `until` is set while the send is inside its undo window: the toast counts down to it. */
export type SendToast = { message: string; undoable: boolean; timeoutMs: number; until?: number };

/** The undo toast's text for a send that goes out in `seconds`. */
export const sendingIn = (seconds: number): string => (seconds > 0 ? `Sending in ${seconds}s` : "Sending…");

/** What the toast after Send says: "Sending in 10s", "Scheduled for Tue 8:00 AM" or "Sent". */
export function describeSend(result: SendResult, now: number, scheduledFor?: number): SendToast {
  if (scheduledFor !== undefined) {
    return { message: `Scheduled for ${formatPresetTime(scheduledFor, now)}`, undoable: true, timeoutMs: 8000 };
  }
  const ms = result.undoUntil - now;
  if (ms <= 0) return { message: "Sent", undoable: false, timeoutMs: 3000 };
  return { message: sendingIn(Math.ceil(ms / 1000)), undoable: true, timeoutMs: ms, until: result.undoUntil };
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
