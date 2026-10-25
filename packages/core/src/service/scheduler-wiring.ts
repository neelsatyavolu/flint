import { logger } from "../log";
import type { Platform } from "../platform";
import type { ReceiptStatus, Settings } from "../types";
import type { ServiceContext } from "./context";

const log = logger("service.scheduler");

/**
 * Shows an OS notification for something the user asked for (a snoozed thread coming back, a follow-up reminder),
 * unless notifications are off. New-mail notifications have their own scope check in notify.ts.
 */
export function notifyUser(platform: Platform, settings: Settings, n: { title: string; body: string; threadId?: number }): void {
  if (!settings.notifications.enabled || settings.notifications.scope === "none") return;
  platform.notify(n);
}

const keyOf = (trackedId: number, email: string): string => `${trackedId}|${email}`;

/**
 * Mail sync does not report which tracked recipients replied, so this watches thread changes instead: when a
 * recipient's status becomes 'replied' it emits a 'receipt' event. Statuses the receipts client already announced
 * are remembered so nothing is announced twice. Returns the unsubscribe function.
 */
export function wireReceiptWatcher(ctx: ServiceContext): () => void {
  const { store } = ctx;
  const known = new Map<string, ReceiptStatus>();
  try {
    for (const t of store.listTracked({ limit: 500 })) for (const r of t.recipients) known.set(keyOf(t.trackedId, r.email), r.status);
  } catch (error) {
    log.warn("could not read tracked messages", { reason: (error as Error).message });
  }

  return ctx.bus.subscribe((event) => {
    if (event.type === "receipt") {
      known.set(keyOf(event.trackedId, event.email), event.status);
      return;
    }
    if (event.type !== "mail_changed" || event.threadIds.length === 0) return;
    const marks = event.threadIds.map(() => "?").join(",");
    const rows = store.db.prepare(`SELECT id FROM tracked_messages WHERE thread_id IN (${marks})`).all(...event.threadIds) as { id: number }[];
    for (const row of rows) {
      const tracked = store.getTracked(row.id);
      for (const r of tracked?.recipients ?? []) {
        const key = keyOf(row.id, r.email);
        const before = known.get(key);
        known.set(key, r.status);
        if (r.status === "replied" && before !== "replied") {
          ctx.emit({ type: "receipt", trackedId: row.id, email: r.email, status: "replied", at: r.repliedAt ?? ctx.now() });
        }
      }
    }
  });
}
