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
