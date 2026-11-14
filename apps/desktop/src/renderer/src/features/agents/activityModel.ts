import type { AgentActivity } from "@flint/core";
import { METHOD_TIERS } from "@flint/core/api";

export const NEEDS_APPROVAL_LABEL = "Needs your approval";

const STATUS_LABELS: Record<AgentActivity["status"], string> = {
  ok: "Done",
  error: "Failed",
  awaiting_approval: "Awaiting approval",
  approved: "Approved",
  denied: "Denied",
};

export function statusLabel(status: AgentActivity["status"]): string {
  return STATUS_LABELS[status];
}

/** The queued send behind an approval request. The service stores its id in detail.scheduledId. */
export function scheduledIdOf(item: AgentActivity): number | null {
  const id = item.detail.scheduledId;
  return typeof id === "number" && Number.isFinite(id) ? id : null;
}

/** Recent calls plus pending approvals that fell outside the recent page, without duplicates. */
export function withPending(recent: AgentActivity[], pending: AgentActivity[]): AgentActivity[] {
  const seen = new Set(recent.map((i) => i.id));
  return [...recent, ...pending.filter((i) => !seen.has(i.id))];
}

export type ActivityGroup ={ label: string; attention: boolean; items: AgentActivity[] };

/** Pending approvals first, then newest-first by day. */
export function groupActivity(items: AgentActivity[], now: number, dayLabel: (at: number, now: number) => string): ActivityGroup[] {
  const sorted = [...items].sort((a, b) => b.at - a.at);
  const pending = sorted.filter((i) => i.status === "awaiting_approval");
  const rest = sorted.filter((i) => i.status !== "awaiting_approval");
  const groups: ActivityGroup[] = pending.length ? [{ label: NEEDS_APPROVAL_LABEL, attention: true, items: pending }] : [];
  for (const item of rest) {
    const label = dayLabel(item.at, now);
    const last = groups[groups.length - 1];
    if (last && !last.attention && last.label === label) last.items.push(item);
    else groups.push({ label, attention: false, items: [item] });
  }
  return groups;
}

/** A call shown on its own, or a burst of successful reads by one agent shown as one line. */
export type ActivityEntry =
  | { kind: "call"; item: AgentActivity }
  | { kind: "reads"; agent: string; items: AgentActivity[] };

/** Reads further apart than this start a new burst. */
const READ_BURST_GAP_MS = 10 * 60_000;
const MAX_READ_PARTS = 3;

function isQuietRead(item: AgentActivity): boolean {
  return item.status === "ok" && (METHOD_TIERS as Record<string, string>)[item.method] === "read";
}

/** Folds consecutive reads by the same agent (newest first, a few minutes apart) into one entry. */
export function foldReads(items: AgentActivity[]): ActivityEntry[] {
  const runs = items.reduce<AgentActivity[][]>((acc, item) => {
    const run = acc[acc.length - 1];
    const prev = run?.[run.length - 1];
    const joins = prev && isQuietRead(prev) && isQuietRead(item) && prev.agent === item.agent && Math.abs(prev.at - item.at) <= READ_BURST_GAP_MS;
    return joins ? [...acc.slice(0, -1), [...run, item]] : [...acc, [item]];
  }, []);
  return runs.map((run) => (run.length > 1 ? { kind: "reads", agent: run[0]!.agent, items: run } : { kind: "call", item: run[0]! }));
}

function joinAnd(words: string[]): string {
  return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** One line for a burst of reads: "Listed drafts, spam and inbox, read thread "Lunch" and 2 more". */
export function describeReads(items: AgentActivity[]): string {
  const distinct = [...new Set(items.map((i) => i.summary))];
  const listed = distinct.filter((s) => s.startsWith("Listed ")).map((s) => s.slice("Listed ".length));
  const listedAt = distinct.findIndex((s) => s.startsWith("Listed "));
  const others = distinct.filter((s) => !s.startsWith("Listed "));
  const parts = listedAt < 0 ? others : [...others.slice(0, listedAt), `Listed ${joinAnd(listed)}`, ...others.slice(listedAt)];
  const shown = parts.slice(0, MAX_READ_PARTS).map((p, i) => (i === 0 ? p : p.charAt(0).toLowerCase() + p.slice(1)));
  const more = parts.length - shown.length;
  return more > 0 ? `${shown.join(", ")} and ${more} more` : shown.join(", ");
}
