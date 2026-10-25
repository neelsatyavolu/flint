import type { Bundle, ThreadListItem } from "@flint/core";
import { dateGroupLabel } from "../lib/format";

export type ThreadEntry = { kind: "thread"; key: string; item: ThreadListItem };
export type BundleEntry = { kind: "bundle"; key: string; bundle: Bundle };
export type ListEntry = ThreadEntry | BundleEntry;

export type LabelRow = { kind: "label"; key: string; label: string };
export type DisplayRow = LabelRow | ListEntry;

export const threadKey = (id: number): string => `t${id}`;
export const bundleKey = (category: Bundle["category"]): string => `b:${category}`;

export function entryDate(entry: ListEntry): number {
  return entry.kind === "thread" ? entry.item.lastDate : entry.bundle.lastDate;
}

/** Threads and bundles in one list, ordered by date. Bundles sit where their latest mail falls. */
export function buildEntries(items: ThreadListItem[], bundles: Bundle[], sort: "newest" | "oldest" = "newest"): ListEntry[] {
  const threads: ListEntry[] = items.map((item) => ({ kind: "thread", key: threadKey(item.id), item }));
  if (bundles.length === 0) return threads;
  const dir = sort === "newest" ? -1 : 1;
  const out = [...threads];
  for (const bundle of bundles) {
    const entry: BundleEntry = { kind: "bundle", key: bundleKey(bundle.category), bundle };
    const at = out.findIndex((e) => dir * (entryDate(e) - bundle.lastDate) > 0);
    if (at === -1) out.push(entry);
    else out.splice(at, 0, entry);
  }
  return out;
}

/** Inserts a date label before the first entry of each group. */
export function groupByDate(entries: ListEntry[], now: number = Date.now()): DisplayRow[] {
  const rows: DisplayRow[] = [];
  let current = "";
  for (const entry of entries) {
    const label = dateGroupLabel(entryDate(entry), now);
    if (label !== current) {
      current = label;
      rows.push({ kind: "label", key: `l:${label}:${rows.length}`, label });
    }
    rows.push(entry);
  }
  return rows;
}
