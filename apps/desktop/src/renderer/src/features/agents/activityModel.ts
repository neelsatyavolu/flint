import type { AgentActivity } from "@flint/core";

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

export type ActivityGroup = { label: string; attention: boolean; items: AgentActivity[] };

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
