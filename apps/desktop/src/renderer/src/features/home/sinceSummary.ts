import { differenceInCalendarDays, format, startOfDay } from "date-fns";
import type { ThreadPage } from "@flint/core";
import { pluralize } from "../../lib/format";
import type { NavTarget } from "../../state/nav";

/** localStorage key: when Home was last left. The local catch-up counts what arrived after it. */
export const HOME_SEEN_KEY = "flint.homeSeenAt";

export type SincePart = { key: string; text: string; target: NavTarget };

/** The last Home visit, or the start of today when there is none (or it is in the future). */
export function sinceStart(stored: number, now: number): number {
  return stored > 0 && stored <= now ? stored : startOfDay(now).getTime();
}

/** "2:00 PM", "yesterday 5:00 PM" or "Mon 5:00 PM". */
export function sinceLabel(since: number, now: number): string {
  const days = differenceInCalendarDays(now, since);
  if (days <= 0) return format(since, "h:mm a");
  if (days === 1) return `yesterday ${format(since, "h:mm a")}`;
  return format(since, "EEE h:mm a");
}

const firstName = (name: string, address: string): string => name.trim().split(/\s+/)[0] || address.split("@")[0] || address;

function whoWrote(names: string[]): string {
  if (names.length === 1) return `${names[0]} wrote`;
  if (names.length === 2) return `${names[0]} and ${names[1]} wrote`;
  return `${names[0]}, ${names[1]} and ${pluralize(names.length - 2, "other")} wrote`;
}

/**
 * What arrived after `since`, from one focused inbox page: people who wrote (the first two named),
 * then unread notifications and newsletters. Each part links to the view it describes.
 */
export function sinceParts(page: ThreadPage, since: number): SincePart[] {
  const names: string[] = [];
  for (const t of [...page.items].sort((a, b) => b.lastDate - a.lastDate)) {
    if (t.category !== "people" || t.lastDate <= since) continue;
    const sender = [...t.participants].reverse().find((p) => p.name !== "me");
    if (!sender) continue;
    const name = firstName(sender.name, sender.address);
    if (!names.includes(name)) names.push(name);
  }
  const parts: SincePart[] = names.length ? [{ key: "people", text: whoWrote(names), target: { view: "inbox" } }] : [];
  for (const b of page.bundles) {
    if (b.lastDate <= since || b.unreadCount === 0) continue;
    const noun = b.category === "notifications" ? "notification" : "newsletter";
    parts.push({ key: b.category, text: pluralize(b.unreadCount, `unread ${noun}`), target: { view: "inbox", category: b.category } });
  }
  return parts;
}
