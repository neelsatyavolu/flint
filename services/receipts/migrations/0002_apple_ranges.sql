-- Apple iCloud Private Relay egress ranges, refreshed daily by the cron from
-- https://mask-api.icloud.com/egress-ip-ranges.csv. The generated snapshot in src/apple-ranges.ts is the fallback.
CREATE TABLE apple_ranges (
  family       TEXT PRIMARY KEY CHECK (family IN ('v4', 'v6')),
  data         TEXT NOT NULL,          -- JSON array: v4 = /24 block numbers, v6 = /36 hex prefixes
  refreshed_at INTEGER NOT NULL        -- epoch ms
);
