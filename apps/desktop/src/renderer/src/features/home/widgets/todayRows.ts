import { endOfDay } from "date-fns";
import type { ScheduledSend, ThreadListItem } from "@flint/core";
import { formatParticipants } from "../../../lib/format";

export type TodayRow =
  | { key: string; kind: "back"; at: number; subject: string; threadId: number }
  | { key: string; kind: "sends"; at: number; subject: string; to: string };

/**
 * What happens later today, in time order: snoozed conversations coming back and pending sends going out.
 * Approval-held sends are left to "Waiting for your OK".
 */
export function todayRows(snoozed: readonly ThreadListItem[], scheduled: readonly ScheduledSend[], now: number): TodayRow[] {
  const end = endOfDay(now).getTime();
  const back: TodayRow[] = snoozed
    .filter((t) => t.snoozedUntil !== null && t.snoozedUntil <= end)
    .map((t) => ({ key: `t${t.id}`, kind: "back", at: t.snoozedUntil!, subject: t.subject, threadId: t.id }));
  const sends: TodayRow[] = scheduled
    .filter((s) => s.status === "pending" && s.sendAt <= end)
    .map((s) => ({ key: `s${s.id}`, kind: "sends", at: s.sendAt, subject: s.subject, to: formatParticipants(s.to, 2) }));
  return [...back, ...sends].sort((a, b) => a.at - b.at);
}
