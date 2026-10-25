export type Env = {
  DB: D1Database;
  /** Secret: wrangler secret put FINGERPRINT_SALT */
  FINGERPRINT_SALT: string;
};

export const DAY_MS = 24 * 60 * 60 * 1000;
export const RETENTION_MS = 180 * DAY_MS;
export const SENDER_FINGERPRINT_TTL_MS = DAY_MS;
export const INSTALL_LIMIT_PER_HOUR = 10;
export const MAX_EVENTS_PER_TOKEN = 300;
export const REGISTER_LIMIT_PER_HOUR = 300;
export const SEEN_LIMIT_PER_HOUR = 120;
export const MAX_TOKENS_PER_INSTALL = 50_000;
/** Per-IP cap across all authenticated endpoints, on top of the per-install caps. Generous enough for a shared office network. */
export const AUTHED_IP_LIMIT_PER_HOUR = 1500;
