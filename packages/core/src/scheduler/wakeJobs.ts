import { logger } from "../log";
import { addressLabel } from "./label";
import type { JobContext } from "./types";

const log = logger("scheduler");

export function nextSnoozeAt(ctx: JobContext): number | null {
  const row = ctx.store.db.prepare("SELECT MIN(snoozed_until) AS t FROM threads WHERE snoozed_until IS NOT NULL").get() as { t: number | null };
  return row.t;
}

export async function runSnoozes(ctx: JobContext): Promise<void> {
  const now = ctx.now();
  for (const threadId of ctx.store.listDueSnoozes(now)) {
    try {
      const rows = ctx.store.getThreadRows(threadId);
      const result = ctx.store.wakeSnoozed(threadId, now);
      if (rows) ctx.emit({ type: "mail_changed", accountId: rows.accountId, threadIds: [threadId] });
      await ctx.jobs.onSnoozeWake?.({ threadId, subject: rows?.subject ?? "", locations: result.locations });
    } catch (err) {
      log.error("snooze wake failed", { threadId, error: err instanceof Error ? err.message : String(err) });
    }
  }
}

export function nextReminderAt(ctx: JobContext): number | null {
  return ctx.store.nextReminderAt();
}

/** Fires reminders whose thread has no reply since the tracked message; marks the rest replied. */
export async function runReminders(ctx: JobContext): Promise<void> {
  const now = ctx.now();
  for (const reminder of ctx.store.listDueReminders(now)) {
    try {
      const sent = ctx.store.findByMessageId(reminder.accountId, reminder.messageId)[0] ?? null;
      const threadId = reminder.threadId ?? sent?.threadId ?? null;
      if (threadId === null) {
        ctx.store.setReminderStatus(reminder.id, "cancelled");
        continue;
      }
      const sentAt = sent?.date ?? reminder.remindAt;
      const replied = ctx.store.threadHasReplySince(threadId, sentAt);
      ctx.store.setReminderStatus(reminder.id, replied ? "replied" : "fired");
      const rows = ctx.store.getThreadRows(threadId);
      if (!replied) {
        ctx.store.resurface(threadId, now);
        if (rows) ctx.emit({ type: "mail_changed", accountId: rows.accountId, threadIds: [threadId] });
      }
      const to = sent?.to[0];
      const message = replied ? "Reply received" : `No reply from ${to ? addressLabel(to) : "the recipient"} yet`;
      await ctx.jobs.onReminder?.({ reminder, threadId, outcome: replied ? "replied" : "fired", message });
    } catch (err) {
      log.error("reminder failed", { reminderId: reminder.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
}
