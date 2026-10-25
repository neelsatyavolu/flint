import type { SyncStatus } from "@flint/core";
import { formatListTime } from "../../../lib/format";

export type StatusTone = "ok" | "warn" | "err" | "muted";
export type AccountStatus = { text: string; tone: StatusTone; needsSignIn: boolean };

/** One short status line for an account, in Data style. */
export function describeStatus(sync: SyncStatus | undefined, enabled: boolean, now: number = Date.now()): AccountStatus {
  if (!enabled) return { text: "Paused", tone: "muted", needsSignIn: false };
  if (!sync) return { text: "Waiting to sync", tone: "muted", needsSignIn: false };
  switch (sync.state) {
    case "syncing": {
      const p = sync.progress;
      return { text: p && p.total > 0 ? `Syncing ${p.done} of ${p.total}` : "Syncing", tone: "muted", needsSignIn: false };
    }
    case "auth_error":
      return { text: "Sign-in expired", tone: "err", needsSignIn: true };
    case "error":
      return { text: sync.error ?? "Sync failed", tone: "err", needsSignIn: false };
    case "offline":
      return { text: "Offline", tone: "warn", needsSignIn: false };
    default:
      return { text: sync.lastSyncAt ? `Synced ${formatListTime(sync.lastSyncAt, now)}` : "Up to date", tone: "ok", needsSignIn: false };
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type AliasCheck = { ok: true; value: string } | { ok: false; message: string };

/** Validates a new alias against the account address and the aliases already added. */
export function checkAlias(raw: string, own: string, existing: string[]): AliasCheck {
  const value = raw.trim().toLowerCase();
  if (!EMAIL.test(value)) return { ok: false, message: "Enter a full email address." };
  if (value === own.toLowerCase()) return { ok: false, message: "That is already the account address." };
  if (existing.some((a) => a.toLowerCase() === value)) return { ok: false, message: "That alias is already added." };
  return { ok: true, value };
}
