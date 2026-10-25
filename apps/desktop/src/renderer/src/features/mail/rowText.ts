import type { Address, ThreadListItem } from "@flint/core";
import { formatListTime, formatParticipants } from "../../lib/format";
import { formatPresetTime } from "../../lib/time";

const isMe = (a: Address) => a.name.trim().toLowerCase() === "me";

/** Sender line: "Carla, Rodney", "me", or a "Draft" marker plus the other people. */
export function rowSender(item: ThreadListItem): { draft: boolean; text: string } {
  const others = item.participants.filter((p) => !isMe(p));
  if (item.hasDraft) return { draft: true, text: formatParticipants(others.length ? others : []) };
  return { draft: false, text: formatParticipants(item.participants) };
}

/** Person whose avatar leads the row: the first participant who isn't the user. */
export function rowAvatar(item: ThreadListItem): Address {
  return item.participants.find((p) => !isMe(p)) ?? item.participants[0] ?? { name: "me", address: "" };
}

/** Right-hand time: the wake time for snoozed mail, else the usual list time. */
export function rowTime(item: ThreadListItem, now: number): { text: string; snoozed: boolean } {
  if (item.snoozedUntil && item.snoozedUntil > now) return { text: formatPresetTime(item.snoozedUntil, now), snoozed: true };
  return { text: formatListTime(item.lastDate, now), snoozed: false };
}
