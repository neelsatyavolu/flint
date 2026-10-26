import { readStored, writeStored } from "../../lib/storage";

export type Usage = Record<string, { n: number; last: number }>;

const KEY = "flint.palette.usage";
const MAX_ENTRIES = 120;
const HALF_LIFE_MS = 3 * 86_400_000;
/** Largest nudge usage can give a match; below the gap between match tiers, so relevance still leads. */
export const MAX_BOOST = 110;

export function loadUsage(): Usage {
  try {
    const parsed: unknown = JSON.parse(readStored(KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object") return {};
    const out: Usage = {};
    for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
      const e = v as { n?: unknown; last?: unknown };
      if (typeof e?.n === "number" && typeof e.last === "number") out[id] = { n: e.n, last: e.last };
    }
    return out;
  } catch {
    return {};
  }
}

/** Returns a new map with `id` counted once more; the least recently used entries beyond the cap drop off. */
export function bump(usage: Usage, id: string, now: number): Usage {
  const next = { ...usage, [id]: { n: (usage[id]?.n ?? 0) + 1, last: now } };
  const ids = Object.keys(next);
  if (ids.length <= MAX_ENTRIES) return next;
  const keep = ids.sort((a, b) => next[b]!.last - next[a]!.last).slice(0, MAX_ENTRIES);
  return Object.fromEntries(keep.map((k) => [k, next[k]!]));
}

export function recordUse(usage: Usage, id: string, now: number = Date.now()): Usage {
  const next = bump(usage, id, now);
  writeStored(KEY, JSON.stringify(next));
  return next;
}

/** Frequency (log-scaled) plus recency (halves every three days). 0 for something never used. */
export function usageBoost(usage: Usage, id: string, now: number): number {
  const e = usage[id];
  if (!e) return 0;
  const frequency = Math.min(MAX_BOOST * 0.55, 16 * Math.log1p(e.n));
  const recency = MAX_BOOST * 0.45 * 0.5 ** (Math.max(0, now - e.last) / HALF_LIFE_MS);
  return frequency + recency;
}

/** Ids from most recently used, newest first. */
export function recentIds(usage: Usage, limit: number): string[] {
  return Object.entries(usage).sort((a, b) => b[1].last - a[1].last).slice(0, limit).map(([id]) => id);
}
