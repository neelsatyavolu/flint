import { refreshAppleRanges } from "./apple-refresh";
import { RETENTION_MS, SENDER_FINGERPRINT_TTL_MS, type Env } from "./env";

/** Daily purge: events and messages older than 180 days, sender fingerprints older than 24h, stale rate limit windows. */
export async function purge(env: Env, now: number): Promise<void> {
  const cutoff = now - RETENTION_MS;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM events WHERE at < ?").bind(cutoff),
    env.DB.prepare("DELETE FROM tokens WHERE registered_at < ?").bind(cutoff),
    env.DB.prepare("DELETE FROM messages WHERE registered_at < ?").bind(cutoff),
    env.DB.prepare("DELETE FROM sender_fingerprints WHERE seen_at < ?").bind(now - SENDER_FINGERPRINT_TTL_MS),
    env.DB.prepare("DELETE FROM rate_limits WHERE window_start < ?").bind(now - 2 * 3_600_000),
    env.DB.prepare("DELETE FROM installs WHERE created_at < ? AND id NOT IN (SELECT install_id FROM messages)").bind(cutoff),
  ]);
}

/** Daily job: purge, then refresh Apple's egress ranges. One failing must not stop the other. */
export async function runDaily(env: Env, now: number, fetchFn: typeof fetch = fetch): Promise<void> {
  const results = await Promise.allSettled([purge(env, now), refreshAppleRanges(env, now, fetchFn)]);
  for (const r of results) {
    if (r.status === "rejected") console.error("receipts: daily job failed", r.reason instanceof Error ? r.reason.message : String(r.reason));
  }
}
