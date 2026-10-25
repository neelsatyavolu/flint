import { logger } from "../log";
import { SEND_RETRY_BACKOFF_MS, type JobContext, type SendRow } from "./types";

const log = logger("scheduler");

function publish(ctx: JobContext, row: SendRow): void {
  ctx.emit({ type: "send", scheduled: row });
}

/** Marks sends left in 'sending' by a crash as failed. They are not retried: the server may already have the mail. */
export function recoverInterruptedSends(ctx: JobContext): void {
  for (const row of ctx.store.listScheduled().filter((r) => r.status === "sending")) {
    const failed = ctx.store.updateScheduled(row.id, { status: "failed", error: "Flint closed while this was sending. Check Sent before sending again." });
    publish(ctx, failed);
  }
}

export function nextSendAt(ctx: JobContext): number | null {
  return ctx.jobs.sendDraft ? ctx.store.nextScheduledAt() : null;
}

/** Sends every pending item that is due. Awaiting-approval items are never picked up. */
export async function runSends(ctx: JobContext): Promise<void> {
  const send = ctx.jobs.sendDraft;
  if (!send) return;
  for (const due of ctx.store.listDueScheduled(ctx.now())) {
    const sending = ctx.store.updateScheduled(due.id, { status: "sending", error: null });
    publish(ctx, sending);
    try {
      const res = await send(due.draftId, due.id);
      const done = ctx.store.updateScheduled(due.id, { status: "sent", error: null, messageId: res?.messageId ?? sending.messageId });
      publish(ctx, done);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const attempts = sending.attempts + 1;
      log.warn("send failed", { scheduledId: due.id, attempts, error: message });
      if (attempts <= SEND_RETRY_BACKOFF_MS.length) {
        const retry = ctx.store.updateScheduled(due.id, { status: "pending", error: message, attempts, sendAt: ctx.now() + SEND_RETRY_BACKOFF_MS[attempts - 1]! });
        publish(ctx, retry);
      } else {
        const failed = ctx.store.updateScheduled(due.id, { status: "failed", error: message, attempts });
        publish(ctx, failed);
        ctx.emit({ type: "toast", level: "error", message: `Couldn't send "${failed.subject || "(no subject)"}". ${message}` });
      }
    }
  }
}
