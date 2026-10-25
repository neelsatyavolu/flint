import type { SendResult } from "@flint/core";
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
