import { logger } from "../log";
import { newMessageId } from "../mail/compose";
import { resolveAuth } from "../mail/connect";
import { openSmtp } from "../mail/bridgeSmtp";
import { sendTracked, sendUntracked, type SendOutcome, type SentFolders, type Smtp } from "../mail/send";
import { injectPixel } from "../receipts";
import { FlintError, type Account, type Address, type Draft } from "../types";
import { assertAttachmentsExist, draftMimeInput } from "./compose-mime";
import { removeDraftDir, draftDir } from "./compose-files";
import type { ServerDrafts } from "./compose-server-drafts";
import type { ComposeHooks, ServiceContext } from "./context";

const log = logger("service.send");

const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** An SMTP transport for the account with fresh credentials (OAuth tokens are refreshed on the way). */
export async function openTransport(ctx: ServiceContext, account: Account): Promise<Smtp> {
  const auth = await resolveAuth(account, {
    secrets: ctx.platform.secrets,
    google: () => ctx.googleClient() ?? { clientId: "", clientSecret: "" },
    fetch: (url, init) => ctx.fetch(url, init),
    now: ctx.now,
  });
  const { transport, smtpSecure } = await openSmtp(account, auth);
  // Bridge answered with STARTTLS where implicit SSL was set: remember what works.
  if (smtpSecure !== account.smtpSecure) ctx.store.updateAccount(account.id, { smtpSecure });
  return transport;
}

function sentFolders(ctx: ServiceContext, account: Account): SentFolders {
  const { store } = ctx;
  const gmail = account.provider === "gmail";
  const sent = store.getFolderByRole(account.id, "sent") ?? (gmail ? null : store.ensureFolderByRole(account.id, "sent"));
  return { provider: account.provider, sentPath: sent?.path ?? null, trashPath: store.getFolderByRole(account.id, "trash")?.path ?? null };
}

/** The tracked row of a send that never went out is removed, so the receipts list has no phantom message. */
async function discardTracking(ctx: ServiceContext, ref: string): Promise<void> {
  const id = ctx.store.findTrackedByRef(ref);
  if (id === null) return;
  await ctx.receipts.stopTracking(id).catch((e: Error) => log.warn("could not tell the receipts service to forget an unsent message", { reason: e.message }));
  ctx.store.db.prepare("DELETE FROM tracked_messages WHERE id = ?").run(id);
}

/** `untrackedReason` is set when the draft asked for read receipts but the mail went out without them. */
type Delivery = { outcome: SendOutcome; ref: string | null; untrackedReason: string | null };

type TrackingBlock = { note: string; toast: string };

/** Why read receipts can't work right now, or null when they can. `note` goes on the message, `toast` into the sent notice. */
function trackingBlock(ctx: ServiceContext, plain: boolean): TrackingBlock | null {
  if (plain) return { note: "Receipts off: plain-text mode", toast: "plain text only is on, and a read receipt needs a tiny image" };
  if (!ctx.getSettings().receipts.enabled) return { note: "Receipts off in Settings", toast: "read receipts are switched off in Settings" };
  return ctx.receipts.isConfigured() ? null : { note: "Receipts off: no receipts address set", toast: "no receipts address is set in Settings" };
}

/** Short reason read receipts can't work for new mail right now (composer hint), or null when they can. */
export function trackingBlockedReason(ctx: ServiceContext): string | null {
  return trackingBlock(ctx, ctx.getSettings().compose.plainTextOnly)?.note ?? null;
}

async function deliver(ctx: ServiceContext, account: Account, draft: Draft, messageId: string): Promise<Delivery> {
  const settings = ctx.getSettings();
  const plain = settings.compose.plainTextOnly;
  const base = { ...draftMimeInput(ctx.store, draft, account, plain), messageId };
  const folders = sentFolders(ctx, account);
  const runner = ctx.syncs.get(account.id);
  const transport = await openTransport(ctx, account);
  let ref: string | null = null;
  try {
    if (!draft.track || plain || !ctx.receipts.isConfigured()) {
      const block = draft.track ? (trackingBlock(ctx, plain) ?? { note: "Receipts unavailable for this message", toast: "read receipts aren't available right now" }) : null;
      const outcome = await sendUntracked(transport, { message: base, folders, runner });
      // Only after the mail left, so a failed send leaves no phantom row.
      if (block) {
        ctx.receipts.recordUntracked({
          accountId: account.id, subject: draft.subject, messageId, recipients: [...draft.to, ...draft.cc, ...draft.bcc],
          selfAddresses: [...ctx.store.ownAddresses()], reason: block.note,
        });
      }
      return { outcome, ref, untrackedReason: block?.toast ?? null };
    }
    const recipients: Address[] = [...draft.to, ...draft.cc, ...draft.bcc];
    const prepared = await ctx.receipts.prepareTracked({
      accountId: account.id, subject: draft.subject, messageId, recipients, selfAddresses: [...ctx.store.ownAddresses()],
    });
    ref = prepared.ref;
    const message = { ...base, headers: { "X-Flint-Ref": prepared.ref } };
    if (prepared.perRecipient.length === 0) {
      const own = new Set(ctx.store.ownAddresses());
      const toSelfOnly = recipients.every((r) => own.has(r.address.toLowerCase()));
      return {
        outcome: await sendUntracked(transport, { message, folders, runner }), ref,
        untrackedReason: toSelfOnly ? null : "the receipts service couldn't be reached",
      };
    }
    const pixels = new Map(prepared.perRecipient.map((r) => [r.token, r.pixelUrl]));
    const outcome = await sendTracked(transport, {
      message, folders, runner,
      tracked: prepared.perRecipient.map((r) => ({ address: r.address.address, token: r.token })),
      untracked: prepared.untracked.map((a) => a.address),
      injectPixel: (html, token) => injectPixel(html, pixels.get(token) ?? ""),
    });
    return { outcome, ref, untrackedReason: null };
  } catch (error) {
    if (ref) await discardTracking(ctx, ref);
    throw error;
  } finally {
    transport.close();
  }
}

/** Everything after the SMTP hand-off. The mail is gone by now, so nothing here may throw. */
async function afterSend(ctx: ServiceContext, account: Account, draft: Draft, delivery: Delivery): Promise<void> {
  const { store } = ctx;
  const { outcome, ref } = delivery;
  try {
    if (draft.threadId !== null && ref) store.linkSentMessage(account.id, ref, outcome.messageId, draft.threadId);
    if (draft.remindAt !== null) {
      store.createReminder({ accountId: account.id, threadId: draft.threadId, messageId: outcome.messageId, remindAt: draft.remindAt });
      ctx.scheduler.poke();
    }
    if (draft.sourceMessageId !== null && (draft.mode === "reply" || draft.mode === "replyAll")) {
      const locs = store.getMessageLocations([draft.sourceMessageId]);
      for (const l of locs) store.applyFlags(l.folderId, [{ uid: l.uid, answered: true }]);
      const report = await ctx.syncs.get(account.id).actions.setAnswered(locs);
      if (!report.ok) log.warn("could not mark the original as answered", { reason: report.errors[0]?.message });
    }
    if (outcome.failed.length > 0) {
      const names = outcome.failed.map((f) => f.address).join(", ");
      ctx.emit({ type: "toast", level: "error", message: `Couldn't deliver "${draft.subject || "(no subject)"}" to ${names}. The other recipients got it.` });
    }
    if (delivery.untrackedReason) {
      ctx.emit({ type: "toast", level: "error", message: `Sent "${draft.subject || "(no subject)"}" without read receipts: ${delivery.untrackedReason}.` });
    }
    ctx.emit({ type: "mail_changed", accountId: account.id, threadIds: draft.threadId === null ? [] : [draft.threadId] });
    // Pull the Sent copy in so the thread, and the tracked row's thread link, show up now.
    void ctx.syncs.get(account.id).syncNow().catch((e: Error) => log.warn("sync after send failed", { reason: e.message }));
  } catch (error) {
    log.warn("post-send bookkeeping failed", { reason: (error as Error).message });
  }
}

/** The scheduler's sendDraft port. Throws before SMTP on problems the retry may fix; never after the mail left. */
export function createSendJob(ctx: ServiceContext): NonNullable<ComposeHooks["sendJob"]> {
  return async (draftId, scheduledId) => {
    const { store } = ctx;
    const draft = store.getDraft(draftId);
    if (!draft) throw new FlintError("not_found", "The draft was deleted before it could be sent.");
    if (draft.to.length + draft.cc.length + draft.bcc.length === 0) throw new FlintError("invalid", "Add at least one recipient.");
    const account = store.requireAccount(draft.accountId);
    await assertAttachmentsExist(draft);
    const row = store.requireScheduled(scheduledId);
    const messageId = row.messageId ?? newMessageId(draft.from);
    if (!row.messageId) store.updateScheduled(scheduledId, { messageId });
    const delivery = await deliver(ctx, account, draft, messageId);
    await afterSend(ctx, account, draft, delivery);
    return { messageId: delivery.outcome.messageId };
  };
}

/** A plain-text message from an account with no draft behind it (unsubscribe by mailto). */
export function createSendRaw(ctx: ServiceContext): NonNullable<ComposeHooks["sendRaw"]> {
  return async ({ accountId, to, subject, text }) => {
    const account = ctx.store.requireAccount(accountId);
    const transport = await openTransport(ctx, account);
    try {
      await sendUntracked(transport, {
        message: { from: { name: account.name, address: account.email }, to, subject, text, html: `<div style="white-space:pre-wrap">${escapeHtml(text)}</div>` },
        folders: sentFolders(ctx, account),
        runner: ctx.syncs.get(account.id),
      });
    } finally {
      transport.close();
    }
  };
}

/**
 * Listens for the scheduler's send events: a sent draft is deleted (local row, files, server copy), and an agent's
 * approval request gets the scheduled send's id in its activity detail so the Approve button knows what to approve.
 */
export function wireSendLifecycle(ctx: ServiceContext, serverDrafts: ServerDrafts): () => void {
  const { store } = ctx;
  return ctx.bus.subscribe((event) => {
    if (event.type === "send" && event.scheduled.status === "sent") {
      const { draftId } = event.scheduled;
      void (async () => {
        const draft = store.getDraft(draftId);
        if (!draft) return;
        await serverDrafts.remove(draftId);
        store.deleteDraft(draftId);
        await removeDraftDir(draftDir(ctx.platform.dataDir, draftId));
        ctx.emit({ type: "mail_changed", accountId: draft.accountId, threadIds: draft.threadId === null ? [] : [draft.threadId] });
      })().catch((e: Error) => log.warn("could not clean up a sent draft", { draftId, reason: e.message }));
      return;
    }
    if (event.type === "agent_activity") tagApprovalRequest(ctx, event.activity);
  });
}

function tagApprovalRequest(ctx: ServiceContext, activity: { id: number; agent: string; method: string; status: string; detail: Record<string, unknown> }): void {
  if (activity.method !== "sendDraft" || activity.status !== "awaiting_approval" || typeof activity.detail["scheduledId"] === "number") return;
  const params = activity.detail["params"];
  const draftId = Array.isArray(params) && typeof params[0] === "number" ? params[0] : null;
  const mine = ctx.store.listScheduled().filter((s) => s.status === "awaiting_approval" && s.requestedBy === `agent:${activity.agent}`);
  const match = mine.filter((s) => s.draftId === draftId).at(-1) ?? mine.at(-1);
  if (!match) return;
  const updated = ctx.store.updateActivity(activity.id, { detail: { scheduledId: match.id } });
  ctx.emit({ type: "agent_activity", activity: updated });
}
