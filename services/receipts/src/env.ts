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
