import { FlintError } from "@flint/core/types";
import type { Address, Draft, DraftInit, DraftPatch, FlintEvent, MessageView, ScheduledSend, SendResult } from "@flint/core";
import { quoteBlock } from "./bodies";
import { registerTracked } from "./seed";
import { nextId, plainSnippet, stripHtml, type MThread, type MockState } from "./state";
import { formatFullDate } from "../lib/format";

export type Ctx = {
  state: MockState;
  now: () => number;
  emit: (e: FlintEvent) => void;
  timers: Map<number, ReturnType<typeof setTimeout>>;
};

const MIN = 60_000;
const sameAddr = (a: Address, b: string) => a.address.toLowerCase() === b.toLowerCase();

function findMessage(state: MockState, id: number): { thread: MThread; message: MessageView } {
  for (const thread of state.threads) {
    const message = thread.messages.find((m) => m.id === id);
    if (message) return { thread, message };
  }
  throw new FlintError("not_found", "That message no longer exists.");
}

const signatureBlock = (ctx: Ctx, accountId: string, mode: "new" | "reply"): { html: string; id: number | null } => {
  const id = ctx.state.settings.compose.defaultSignatureByAccount[accountId] ?? null;
  const sig = ctx.state.signatures.find((s) => s.id === id && (mode === "new" ? s.defaultNew : s.defaultReply));
  return sig ? { id: sig.id, html: `<div class="flint-signature" data-signature-id="${sig.id}">${sig.html}</div>` } : { id: null, html: "" };
};

function dedupe(list: Address[], exclude: string[]): Address[] {
  const seen = new Set(exclude.map((e) => e.toLowerCase()));
  return list.filter((a) => (seen.has(a.address.toLowerCase()) ? false : (seen.add(a.address.toLowerCase()), true)));
}

export function createDraft(ctx: Ctx, init: DraftInit): Draft {
  const { state } = ctx;
  const track = state.settings.receipts.enabled && state.settings.receipts.defaultOn;
  const base = { id: nextId(state, "draft"), bcc: [] as Address[], attachments: [], remindAt: null, createdBy: "user", updatedAt: ctx.now(), track };
  let draft: Draft;
  let thread: MThread | undefined;

  if (init.mode === "new") {
    const accountId = init.accountId ?? state.accounts[0]!.id;
    const account = state.accounts.find((a) => a.id === accountId) ?? state.accounts[0]!;
    const tpl = init.templateId ? state.templates.find((t) => t.id === init.templateId) : undefined;
    const sig = signatureBlock(ctx, account.id, "new");
    draft = { ...base, accountId: account.id, from: account.email, mode: "new", sourceMessageId: null, threadId: null, to: init.to ?? [], cc: [], subject: init.subject ?? tpl?.subject ?? "", html: `${init.html ?? tpl?.html ?? ""}${sig.html}`, quotedHtml: "", signatureId: sig.id };
  } else {
    const { thread: t, message } = findMessage(state, init.messageId);
    thread = t;
    const account = state.accounts.find((a) => a.id === t.accountId)!;
    const sig = signatureBlock(ctx, account.id, "reply");
    const self = [account.email, ...account.aliases];
    const primary = message.replyTo[0] ?? message.from[0]!;
    const replyTarget = message.isFromMe ? message.to : [primary];
    const to = init.mode === "forward" ? [] : init.mode === "reply" ? dedupe(replyTarget, []) : dedupe([...replyTarget, ...message.to], self);
    const cc = init.mode === "replyAll" ? dedupe(message.cc, [...self, ...to.map((x) => x.address)]) : [];
    const prefix = init.mode === "forward" ? "Fwd: " : "Re: ";
    const subject = t.subject.replace(/^(re|fwd?):\s*/i, "");
    draft = {
      ...base, accountId: account.id, from: account.email, mode: init.mode, sourceMessageId: message.id, threadId: t.id, to, cc, subject: `${prefix}${subject}`,
      html: `${init.html ?? ""}${sig.html}`, quotedHtml: quoteBlock(message.from[0]!, formatFullDate(message.date), message.html ?? `<p>${message.text ?? ""}</p>`), signatureId: sig.id,
    };
  }

  if (thread) {
    state.threads = state.threads.map((t) => (t.id === thread!.id ? { ...t, draftIds: [...t.draftIds, draft.id] } : t));
  } else {
    const t: MThread = { id: nextId(state, "thread"), accountId: draft.accountId, subject: draft.subject, category: "people", pinned: false, muted: false, snoozedUntil: null, resurfacedAt: null, location: "drafts", folderIds: [], blocked: false, messages: [], draftIds: [draft.id] };
    draft = { ...draft, threadId: t.id };
    state.threads = [...state.threads, t];
  }
  state.drafts = [...state.drafts, draft];
  ctx.emit({ type: "mail_changed", accountId: draft.accountId, threadIds: draft.threadId ? [draft.threadId] : [] });
  return draft;
}

export function getDraft(ctx: Ctx, id: number): Draft {
  const d = ctx.state.drafts.find((x) => x.id === id);
  if (!d) throw new FlintError("not_found", "That draft no longer exists.");
  return d;
}

export function updateDraft(ctx: Ctx, id: number, patch: DraftPatch): Draft {
  const current = getDraft(ctx, id);
  const account = patch.accountId ? ctx.state.accounts.find((a) => a.id === patch.accountId) : undefined;
  const next: Draft = { ...current, ...patch, ...(account && !patch.from ? { from: account.email } : {}), updatedAt: ctx.now() };
  ctx.state.drafts = ctx.state.drafts.map((d) => (d.id === id ? next : d));
  if (next.threadId && patch.subject !== undefined) {
    ctx.state.threads = ctx.state.threads.map((t) => (t.id === next.threadId && t.messages.length === 0 ? { ...t, subject: next.subject } : t));
  }
  ctx.emit({ type: "mail_changed", accountId: next.accountId, threadIds: next.threadId ? [next.threadId] : [] });
  return next;
}

export function deleteDraft(ctx: Ctx, id: number): void {
  const d = getDraft(ctx, id);
  ctx.state.drafts = ctx.state.drafts.filter((x) => x.id !== id);
  ctx.state.threads = ctx.state.threads
    .map((t) => (t.draftIds.includes(id) ? { ...t, draftIds: t.draftIds.filter((x) => x !== id) } : t))
    .filter((t) => !(t.location === "drafts" && t.messages.length === 0 && t.draftIds.length === 0));
  ctx.emit({ type: "mail_changed", accountId: d.accountId, threadIds: d.threadId ? [d.threadId] : [] });
}

function deliver(ctx: Ctx, scheduledId: number): void {
  const { state } = ctx;
  const job = state.scheduled.find((s) => s.id === scheduledId);
  const draft = job && state.drafts.find((d) => d.id === job.draftId);
  if (!job || !draft || job.status !== "pending") return;
  const now = ctx.now();
  const text = stripHtml(draft.html);
  const msg: MessageView = {
    id: nextId(state, "message"), accountId: draft.accountId, threadId: draft.threadId ?? 0, messageId: `<sent${scheduledId}@mock.flint>`, from: [{ name: state.accounts.find((a) => a.id === draft.accountId)?.name ?? "me", address: draft.from }],
    to: draft.to, cc: draft.cc, bcc: draft.bcc, replyTo: [], subject: draft.subject, date: now, seen: true, pinned: false, isFromMe: true, snippet: plainSnippet(text),
    html: draft.html + draft.quotedHtml, text, bodyLoaded: true, remoteImages: "allowed", hasTrackers: false,
    attachments: draft.attachments.map((a, i) => ({ id: nextId(state, "attachment") + i, filename: a.filename, contentType: a.contentType, size: a.size, inline: false, contentId: null })),
    unsubscribe: null, receipt: null,
  };
  if (draft.track && state.settings.receipts.enabled) {
    const recipients = [...draft.to, ...draft.cc, ...draft.bcc].map((who) => ({ who, status: "sent" as const }));
    const tid = registerTracked(state, draft.accountId, draft.threadId ?? 0, draft.subject, now, recipients);
    msg.receipt = state.receipts[tid] ?? null;
  }
  state.threads = state.threads.map((t) => {
    if (t.id !== draft.threadId) return t;
    const wasDraftOnly = t.messages.length === 0;
    return { ...t, messages: [...t.messages, msg], draftIds: t.draftIds.filter((x) => x !== draft.id), location: wasDraftOnly ? "sent" : t.location };
  });
  state.drafts = state.drafts.filter((d) => d.id !== draft.id);
  const done: ScheduledSend = { ...job, status: "sent" };
  state.scheduled = state.scheduled.map((s) => (s.id === scheduledId ? done : s));
  ctx.timers.delete(scheduledId);
  ctx.emit({ type: "send", scheduled: done });
  ctx.emit({ type: "mail_changed", accountId: draft.accountId, threadIds: draft.threadId ? [draft.threadId] : [] });
}

function arm(ctx: Ctx, job: ScheduledSend): void {
  const delay = job.sendAt - ctx.now();
  if (delay > 60_000) return; // far-future sends only exist as records in the mock
  const timer = setTimeout(() => deliver(ctx, job.id), Math.max(0, delay));
  (timer as { unref?: () => void }).unref?.();
  ctx.timers.set(job.id, timer);
}

export function sendDraft(ctx: Ctx, id: number, opts?: { sendAt?: number }): SendResult {
  const draft = getDraft(ctx, id);
  if (draft.to.length + draft.cc.length + draft.bcc.length === 0) throw new FlintError("invalid", "Add at least one recipient before sending.");
  const now = ctx.now();
  const undoMs = ctx.state.settings.compose.undoSendSeconds * 1000;
  const sendAt = opts?.sendAt ?? now + undoMs;
  const agent = draft.createdBy !== "user";
  const status: ScheduledSend["status"] = agent && ctx.state.settings.agents.send === "ask" ? "awaiting_approval" : "pending";
  const job: ScheduledSend = { id: nextId(ctx.state, "scheduled"), draftId: id, subject: draft.subject, to: draft.to, sendAt, status, error: null, requestedBy: draft.createdBy };
  ctx.state.scheduled = [...ctx.state.scheduled, job];
  if (status === "pending") arm(ctx, job);
  ctx.emit({ type: "send", scheduled: job });
  ctx.emit({ type: "mail_changed", accountId: draft.accountId, threadIds: draft.threadId ? [draft.threadId] : [] });
  return { scheduledId: job.id, sendAt, undoUntil: Math.min(sendAt, now + undoMs), status };
}

export function cancelSend(ctx: Ctx, scheduledId: number): Draft {
  const job = ctx.state.scheduled.find((s) => s.id === scheduledId);
  if (!job) throw new FlintError("not_found", "That send no longer exists.");
  if (job.status === "sent") throw new FlintError("conflict", "That message was already sent.");
  const timer = ctx.timers.get(scheduledId);
  if (timer) clearTimeout(timer);
  ctx.timers.delete(scheduledId);
  ctx.state.scheduled = ctx.state.scheduled.map((s) => (s.id === scheduledId ? { ...s, status: "cancelled" } : s));
  const draft = getDraft(ctx, job.draftId);
  ctx.emit({ type: "mail_changed", accountId: draft.accountId, threadIds: draft.threadId ? [draft.threadId] : [] });
  return draft;
}

export function approveSend(ctx: Ctx, scheduledId: number, approve: boolean): ScheduledSend {
  const job = ctx.state.scheduled.find((s) => s.id === scheduledId);
  if (!job) throw new FlintError("not_found", "That send no longer exists.");
  const next: ScheduledSend = { ...job, status: approve ? "pending" : "cancelled", sendAt: approve ? ctx.now() + 2000 : job.sendAt };
  ctx.state.scheduled = ctx.state.scheduled.map((s) => (s.id === scheduledId ? next : s));
  const activity = ctx.state.activity.find((a) => a.status === "awaiting_approval" && a.detail.scheduledId === scheduledId);
  if (activity) {
    const updated = { ...activity, status: approve ? ("approved" as const) : ("denied" as const) };
    ctx.state.activity = ctx.state.activity.map((a) => (a.id === activity.id ? updated : a));
    ctx.emit({ type: "agent_activity", activity: updated });
  }
  if (approve) arm(ctx, next);
  ctx.emit({ type: "send", scheduled: next });
  return next;
}
