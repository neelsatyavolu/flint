import { z } from "zod";
import type { FlintApi } from "../api";
import type { ScheduledSendRow } from "../store";
import { FlintError, type ScheduledSend } from "../types";
import type { ServiceContext } from "./context";

export type QueueApi = Pick<FlintApi, "sendDraft" | "cancelSend" | "listScheduled" | "approveSend">;

const id = z.number().int().positive();
const sendOpts = z.object({ sendAt: z.number().int().positive().optional() }).strict().nullish();

/** The public shape of a queued send, without the scheduler's bookkeeping columns. */
export function publicScheduled(row: ScheduledSendRow): ScheduledSend {
  return { id: row.id, draftId: row.draftId, subject: row.subject, to: row.to, sendAt: row.sendAt, status: row.status, error: row.error, requestedBy: row.requestedBy };
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new FlintError("invalid", result.error.issues[0]?.message ?? "That input is not valid.");
  return result.data;
}

export function queueApi(ctx: ServiceContext): QueueApi {
  const { store } = ctx;

  const announce = (row: ScheduledSendRow): ScheduledSend => {
    const view = publicScheduled(row);
    ctx.emit({ type: "send", scheduled: view });
    const draft = store.getDraft(row.draftId);
    if (draft) ctx.emit({ type: "mail_changed", accountId: draft.accountId, threadIds: draft.threadId === null ? [] : [draft.threadId] });
    ctx.scheduler.poke();
    return view;
  };

  /** Marks the agent's approval request in Agent Activity as decided. */
  const settleActivity = (scheduledId: number, approved: boolean): void => {
    const pending = store.listActivity({ limit: 500 }).find((a) => a.status === "awaiting_approval" && a.detail["scheduledId"] === scheduledId);
    if (!pending) return;
    ctx.emit({ type: "agent_activity", activity: store.updateActivity(pending.id, { status: approved ? "approved" : "denied" }) });
  };

  const undoWindowMs = (): number => ctx.getSettings().compose.undoSendSeconds * 1000;

  return {
    async sendDraft(draftId, rawOpts) {
      const opts = parse(sendOpts, rawOpts) ?? {};
      const draft = store.requireDraft(parse(id, draftId));
      if (draft.to.length + draft.cc.length + draft.bcc.length === 0) throw new FlintError("invalid", "Add at least one recipient before sending.");
      if (store.findOpenScheduledForDraft(draft.id)) throw new FlintError("conflict", "This message is already queued to send.");
      const settings = ctx.getSettings();
      const agent = ctx.caller();
      if (agent && settings.agents.send === "deny") throw new FlintError("permission", "Agents can't send mail right now. Allow sending in Settings, Agents.");
      const now = ctx.now();
      const sendAt = Math.max(opts.sendAt ?? now + undoWindowMs(), now);
      const status = agent && settings.agents.send === "ask" ? "awaiting_approval" : "pending";
      const row = store.createScheduledSend({ draftId: draft.id, sendAt, status, requestedBy: agent ? `agent:${agent}` : "user" }, now);
      announce(row);
      return { scheduledId: row.id, sendAt, undoUntil: sendAt, status };
    },

    async cancelSend(scheduledId) {
      const row = store.requireScheduled(parse(id, scheduledId));
      if (row.status === "sending") throw new FlintError("conflict", "It's already on its way and can't be cancelled.");
      if (row.status === "sent") throw new FlintError("conflict", "That message was already sent.");
      const draft = store.requireDraft(row.draftId);
      if (row.status === "pending" || row.status === "awaiting_approval") {
        const cancelled = store.updateScheduled(row.id, { status: "cancelled", error: null });
        if (row.status === "awaiting_approval") settleActivity(row.id, false);
        announce(cancelled);
      }
      return draft;
    },

    async listScheduled() {
      return store.listScheduled().map(publicScheduled);
    },

    async approveSend(scheduledId, approve) {
      const row = store.requireScheduled(parse(id, scheduledId));
      if (row.status !== "awaiting_approval") throw new FlintError("conflict", "That send isn't waiting for approval.");
      const next = approve
        ? store.updateScheduled(row.id, { status: "pending", sendAt: Math.max(row.sendAt, ctx.now() + undoWindowMs()) })
        : store.updateScheduled(row.id, { status: "cancelled" });
      settleActivity(row.id, approve);
      return announce(next);
    },
  };
}
