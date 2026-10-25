import { parseEgressCsv, SNAPSHOT_RANGES, type AppleRanges } from "./apple";
import type { Env } from "./env";

export const APPLE_EGRESS_URL = "https://mask-api.icloud.com/egress-ip-ranges.csv";
/** A refresh smaller than this fraction of the built-in snapshot is treated as a broken download and ignored. */
const MIN_FRACTION_OF_SNAPSHOT = 0.5;
const CACHE_TTL_MS = 60 * 60 * 1000;

let cache: { at: number; ranges: AppleRanges } | null = null;

/** Test hook. */
export function resetAppleRangesCache(): void {
  cache = null;
}

function parseStored<T>(data: string, ok: (v: unknown) => v is T): T[] | null {
  try {
    const v: unknown = JSON.parse(data);
    return Array.isArray(v) && v.every(ok) ? (v as T[]) : null;
  } catch {
    return null;
  }
}

/** Ranges for classification: the daily D1 refresh when present, else the generated snapshot. Never throws. */
export async function loadAppleRanges(env: Env, now: number): Promise<AppleRanges> {
  if (cache && now - cache.at < CACHE_TTL_MS && now >= cache.at) return cache.ranges;
  let ranges = SNAPSHOT_RANGES;
  try {
    const rows = await env.DB.prepare("SELECT family, data FROM apple_ranges").all<{ family: string; data: string }>();
    const v4 = parseStored(rows.results.find((r) => r.family === "v4")?.data ?? "", (x): x is number => typeof x === "number");
    const v6 = parseStored(rows.results.find((r) => r.family === "v6")?.data ?? "", (x): x is string => typeof x === "string");
    if (v4 && v6 && v4.length > 0) ranges = { v4: new Set(v4), v6: new Set(v6) };
  } catch (err) {
    console.error("receipts: could not load apple ranges", err instanceof Error ? err.message : String(err));
  }
  cache = { at: now, ranges };
  return ranges;
}

/** Downloads Apple's egress list into D1. Returns false (and keeps the old data) when the download looks wrong. */
export async function refreshAppleRanges(env: Env, now: number, fetchFn: typeof fetch = fetch): Promise<boolean> {
  const res = await fetchFn(APPLE_EGRESS_URL, { headers: { Accept: "text/csv" } });
  if (!res.ok) throw new Error(`Apple egress list returned ${res.status}`);
  const parsed = parseEgressCsv(await res.text());
  const floor = SNAPSHOT_RANGES.v4.size * MIN_FRACTION_OF_SNAPSHOT;
  if (parsed.v4.size < floor || parsed.v6.size === 0) {
    console.error(`receipts: apple egress list looks wrong (${parsed.v4.size} v4 blocks), keeping previous ranges`);
    return false;
  }
  const upsert = (family: string, data: unknown) =>
    env.DB.prepare(
      "INSERT INTO apple_ranges (family, data, refreshed_at) VALUES (?, ?, ?) ON CONFLICT(family) DO UPDATE SET data = excluded.data, refreshed_at = excluded.refreshed_at",
    ).bind(family, JSON.stringify(data), now);
  await env.DB.batch([upsert("v4", [...parsed.v4].sort((a, b) => a - b)), upsert("v6", [...parsed.v6].sort())]);
  cache = null;
  return true;
}
