import { z } from "zod";
import type { FlintApi } from "../api";
import { logger } from "../log";
import { buildReplyDraft, type ReplySource } from "../mail/compose";
import { FlintError, type Account, type Draft, type DraftAttachment, type Signature } from "../types";
import { copyIntoDraft, draftDir, removeDraftDir, removeDraftFile, writeIntoDraft } from "./compose-files";
import { defaultSignature, replaceSignature } from "./compose-signature";
import type { ServerDrafts } from "./compose-server-drafts";
import type { ServiceContext } from "./context";

const log = logger("service.drafts");

export type DraftsApi = Pick<FlintApi,
  "createDraft" | "getDraft" | "updateDraft" | "deleteDraft" | "listDrafts" | "addAttachment" | "removeAttachment">;

const address = z.object({
  name: z.string().max(300),
  address: z.string().trim().min(3).max(320).refine((a) => a.includes("@") && !/\s/.test(a), "Enter a full email address."),
});
const initSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("new"), accountId: z.string().optional(), to: z.array(address).max(500).optional(),
    subject: z.string().max(998).optional(), html: z.string().max(5_000_000).optional(), templateId: z.number().int().positive().optional(),
  }),
  z.object({ mode: z.enum(["reply", "replyAll", "forward"]), messageId: z.number().int().positive(), html: z.string().max(5_000_000).optional() }),
]);
const patchSchema = z.object({
  from: z.string().trim().min(3).max(320), accountId: z.string(), to: z.array(address).max(500), cc: z.array(address).max(500),
  bcc: z.array(address).max(500), subject: z.string().max(998), html: z.string().max(5_000_000),
  signatureId: z.number().int().positive().nullable(), track: z.boolean(), remindAt: z.number().int().positive().nullable(),
}).partial().strict();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new FlintError("invalid", result.error.issues[0]?.message ?? "That input is not valid.");
  return result.data;
}

const addressesOf = (a: Account): string[] => [a.email, ...a.aliases].map((x) => x.toLowerCase());

/** The send-as address of the account that the original was sent to, so a reply goes out from the same alias. */
function replyFrom(account: Account, msg: { to: { address: string }[]; cc: { address: string }[] }): string {
  const addressed = new Set([...msg.to, ...msg.cc].map((a) => a.address.toLowerCase()));
  const alias = account.aliases.find((a) => addressed.has(a.toLowerCase()));
  return addressed.has(account.email.toLowerCase()) || !alias ? account.email : alias;
}

export function draftsApi(ctx: ServiceContext, serverDrafts: ServerDrafts): DraftsApi {
  const { store } = ctx;

  const creator = (): string => { const agent = ctx.caller(); return agent ? `agent:${agent}` : "user"; };
  const changed = (d: Pick<Draft, "accountId" | "threadId">): void =>
    ctx.emit({ type: "mail_changed", accountId: d.accountId, threadIds: d.threadId === null ? [] : [d.threadId] });
  /**
   * An agent may not touch a draft that is queued to send: the person approved (or is about to approve) the mail
   * as it was when it was queued. They must cancel the send first. Agents also only delete drafts they made.
   */
  function assertAgentMayChange(draft: Draft, deleting = false): void {
    const agent = ctx.caller();
    if (!agent) return;
    if (deleting && draft.createdBy !== `agent:${agent}`) {
      throw new FlintError("permission", "Agents can only delete drafts they created.");
    }
    if (store.findOpenScheduledForDraft(draft.id)) {
      throw new FlintError("conflict", "This draft is queued to send. Cancel the send before changing it.");
    }
  }
  const trackDefault = (): boolean => { const r = ctx.getSettings().receipts; return r.enabled && r.defaultOn; };

  function firstAccount(): Account {
    const account = store.listAccounts().find((a) => a.enabled) ?? store.listAccounts()[0];
    if (!account) throw new FlintError("invalid", "Add an account before writing mail.");
    return account;
  }

  function body(base: string, sig: Signature | null): string {
    return sig ? replaceSignature(base, sig) : base;
  }

  async function createNew(init: Extract<z.infer<typeof initSchema>, { mode: "new" }>): Promise<Draft> {
    const account = init.accountId ? store.getAccount(init.accountId) : firstAccount();
    if (!account) throw new FlintError("not_found", "That account no longer exists.");
    const template = init.templateId === undefined ? null : store.getTemplate(init.templateId);
    if (init.templateId !== undefined && !template) throw new FlintError("not_found", "That template no longer exists.");
    const sig = defaultSignature(store, ctx.getSettings(), account.id, "new");
    return store.createDraft({
      accountId: account.id, from: account.email, mode: "new", to: init.to ?? [],
      subject: init.subject ?? template?.subject ?? "",
      html: body(`${template?.html ?? ""}${init.html ?? ""}`, sig), signatureId: sig?.id ?? null,
      track: trackDefault(), createdBy: creator(),
    }, ctx.now());
  }

  async function carryAttachments(draft: Draft, accountId: string, messageRowId: number, threadId: number): Promise<DraftAttachment[]> {
    const source = store.getThreadRows(threadId)?.messages.find((m) => m.id === messageRowId);
    const out: DraftAttachment[] = [];
    for (const a of (source?.attachments ?? []).filter((x) => !x.inline)) {
      const data = await ctx.syncs.get(accountId).fetchAttachment(a.id);
      out.push(await writeIntoDraft(draftDir(ctx.platform.dataDir, draft.id), a.filename, a.contentType, data, out));
    }
    return out;
  }

  async function createFromMessage(init: Extract<z.infer<typeof initSchema>, { mode: "reply" | "replyAll" | "forward" }>): Promise<Draft> {
    if (!store.getMessage(init.messageId)) throw new FlintError("not_found", "That message no longer exists.");
    await ctx.ensureBodies([init.messageId]);
    const msg = store.getMessage(init.messageId)!;
    const account = store.requireAccount(msg.accountId);
    const source: ReplySource = {
      from: msg.from, to: msg.to, cc: msg.cc, replyTo: msg.replyTo, subject: msg.subject, date: msg.date,
      messageId: msg.messageId, references: msg.references, rawHtml: msg.rawHtml, text: msg.text,
    };
    const reply = buildReplyDraft(source, init.mode, store.ownAddresses());
    const sig = defaultSignature(store, ctx.getSettings(), account.id, init.mode);
    const draft = store.createDraft({
      accountId: account.id, from: replyFrom(account, msg), mode: init.mode, sourceMessageId: msg.id, threadId: msg.threadId,
      to: reply.to, cc: reply.cc, subject: reply.subject, html: body(init.html ?? "", sig), quotedHtml: reply.quotedHtml,
      signatureId: sig?.id ?? null, track: trackDefault(), createdBy: creator(),
      inReplyTo: reply.inReplyTo, references: reply.references,
    }, ctx.now());
    if (init.mode !== "forward") return draft;
    try {
      const attachments = await carryAttachments(draft, account.id, msg.id, msg.threadId);
      return attachments.length ? store.updateDraft(draft.id, { attachments }, ctx.now()) : draft;
    } catch (error) {
      store.deleteDraft(draft.id);
      await removeDraftDir(draftDir(ctx.platform.dataDir, draft.id));
      log.warn("could not carry attachments into a forward", { reason: (error as Error).message });
      throw error instanceof FlintError ? error : new FlintError("network", "Couldn't load the attachments to forward. Try again.");
    }
  }

  /** The account a patch moves the draft to, and the address it sends from. */
  function resolveSender(draft: Draft, patch: z.infer<typeof patchSchema>): { account: Account; from: string } {
    const wanted = patch.from?.toLowerCase();
    const owner = wanted ? store.listAccounts().find((a) => addressesOf(a).includes(wanted)) : undefined;
    if (patch.from && !owner) throw new FlintError("invalid", "That address doesn't belong to any of your accounts.");
    const account = patch.accountId ? store.getAccount(patch.accountId) : (owner ?? store.requireAccount(draft.accountId));
    if (!account) throw new FlintError("not_found", "That account no longer exists.");
    if (patch.accountId && owner && owner.id !== account.id) throw new FlintError("invalid", "That address belongs to a different account.");
    const from = patch.from ?? (account.id === draft.accountId ? draft.from : account.email);
    if (!addressesOf(account).includes(from.toLowerCase())) throw new FlintError("invalid", "That address doesn't belong to this account.");
    return { account, from };
  }

  return {
    async createDraft(rawInit) {
      const init = parse(initSchema, rawInit);
      const draft = init.mode === "new" ? await createNew(init) : await createFromMessage(init);
      changed(draft);
      return draft;
    },

    async getDraft(id) {
      return store.requireDraft(parse(z.number().int().positive(), id));
    },

    async listDrafts() {
      return store.listDrafts();
    },

    async updateDraft(id, rawPatch) {
      const patch = parse(patchSchema, rawPatch);
      const draft = store.requireDraft(parse(z.number().int().positive(), id));
      assertAgentMayChange(draft);
      const sender = resolveSender(draft, patch);
      const accountChanged = sender.account.id !== draft.accountId;

      let signatureId = draft.signatureId;
      let html = patch.html ?? draft.html;
      if (patch.signatureId !== undefined || accountChanged) {
        const sig = patch.signatureId === undefined
          ? defaultSignature(store, ctx.getSettings(), sender.account.id, draft.mode)
          : patch.signatureId === null ? null : store.getSignature(patch.signatureId);
        if (patch.signatureId && !sig) throw new FlintError("not_found", "That signature no longer exists.");
        html = replaceSignature(html, sig);
        signatureId = sig?.id ?? null;
      }
      const { from: _from, accountId: _account, signatureId: _sig, html: _html, ...rest } = patch;
      const updated = store.updateDraft(draft.id, {
        ...rest, accountId: sender.account.id, from: sender.from, html, signatureId,
      }, ctx.now());
      serverDrafts.touch(draft.id);
      return updated;
    },

    async deleteDraft(id) {
      const draft = store.getDraft(parse(z.number().int().positive(), id));
      if (!draft) return;
      assertAgentMayChange(draft, true);
      if (store.findOpenScheduledForDraft(draft.id)?.status === "sending") {
        throw new FlintError("conflict", "This message is being sent right now.");
      }
      await serverDrafts.remove(draft.id);
      store.deleteDraft(draft.id);
      await removeDraftDir(draftDir(ctx.platform.dataDir, draft.id));
      ctx.scheduler.poke();
      changed(draft);
    },

    async addAttachment(draftId, filePath) {
      if (ctx.caller()) throw new FlintError("permission", "Agents can't attach files from this computer.");
      const draft = store.requireDraft(parse(z.number().int().positive(), draftId));
      const path = parse(z.string().min(1).max(4096), filePath);
      const att = await copyIntoDraft(draftDir(ctx.platform.dataDir, draft.id), path, draft.attachments);
      const updated = store.updateDraft(draft.id, { attachments: [...draft.attachments, att] }, ctx.now());
      serverDrafts.touch(draft.id);
      return updated;
    },

    async removeAttachment(draftId, attachmentId) {
      const draft = store.requireDraft(parse(z.number().int().positive(), draftId));
      assertAgentMayChange(draft);
      const target = draft.attachments.find((a) => a.id === attachmentId);
      if (!target) return draft;
      const updated = store.updateDraft(draft.id, { attachments: draft.attachments.filter((a) => a.id !== attachmentId) }, ctx.now());
      await removeDraftFile(draftDir(ctx.platform.dataDir, draft.id), target.path);
      serverDrafts.touch(draft.id);
      return updated;
    },
  };
}
