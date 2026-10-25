import type { Draft, DraftPatch } from "@flint/core/types";
import { FlintError } from "@flint/core/types";
import { emit, parseAddresses, parseId, resolveAccountId, type Ctx } from "../ctx";
import { formatAddresses, textToHtml } from "../text";
import { formatFull, parseFuture } from "../time";

export type ComposeOpts = {
  to?: string[]; cc?: string[]; bcc?: string[]; subject?: string; body?: string; bodyFile?: string; account?: string;
};

async function bodyHtml(ctx: Ctx, opts: ComposeOpts): Promise<string | undefined> {
  if (opts.body !== undefined && opts.bodyFile !== undefined) throw new FlintError("invalid", "Use --body or --body-file, not both.");
  const text = opts.bodyFile !== undefined ? await ctx.readFile(opts.bodyFile) : opts.body;
  return text === undefined ? undefined : textToHtml(text);
}

function draftLine(d: Draft): string {
  return [`Draft ${d.id} created.`, `To: ${formatAddresses(d.to) || "(none)"}`, `Subject: ${d.subject || "(none)"}`, `Send it with: flint send ${d.id}`].join("\n");
}

async function newDraft(ctx: Ctx, opts: ComposeOpts): Promise<Draft> {
  const to = parseAddresses(opts.to);
  if (to.length === 0) throw new FlintError("invalid", "Add a recipient with --to.");
  const created = await ctx.client.createDraft({
    mode: "new", accountId: await resolveAccountId(ctx, opts.account), to, subject: opts.subject, html: await bodyHtml(ctx, opts),
  });
  const patch: DraftPatch = {};
  const cc = parseAddresses(opts.cc);
  const bcc = parseAddresses(opts.bcc);
  if (cc.length) patch.cc = cc;
  if (bcc.length) patch.bcc = bcc;
  return Object.keys(patch).length ? ctx.client.updateDraft(created.id, patch) : created;
}

export async function draft(ctx: Ctx, opts: ComposeOpts): Promise<void> {
  emit(ctx, await newDraft(ctx, opts), draftLine);
}

async function replyOrForward(ctx: Ctx, idRaw: string, mode: "reply" | "replyAll" | "forward", opts: ComposeOpts): Promise<void> {
  const thread = await ctx.client.getThread(parseId(idRaw));
  const target = [...thread.messages].reverse().find((m) => !m.isFromMe) ?? thread.messages.at(-1);
  if (!target) throw new FlintError("not_found", "That thread has no messages.");
  let d = await ctx.client.createDraft({ mode, messageId: target.id, html: await bodyHtml(ctx, opts) });
  const patch: DraftPatch = {};
  const to = parseAddresses(opts.to);
  const cc = parseAddresses(opts.cc);
  const bcc = parseAddresses(opts.bcc);
  if (mode === "forward" && to.length === 0) throw new FlintError("invalid", "Add a recipient with --to.");
  if (to.length) patch.to = to;
  if (cc.length) patch.cc = cc;
  if (bcc.length) patch.bcc = bcc;
  if (opts.subject !== undefined) patch.subject = opts.subject;
  if (Object.keys(patch).length) d = await ctx.client.updateDraft(d.id, patch);
  emit(ctx, d, draftLine);
}

export const reply = (ctx: Ctx, id: string, opts: ComposeOpts & { all?: boolean }): Promise<void> =>
  replyOrForward(ctx, id, opts.all ? "replyAll" : "reply", opts);

export const forward = (ctx: Ctx, id: string, opts: ComposeOpts): Promise<void> => replyOrForward(ctx, id, "forward", opts);

export async function send(ctx: Ctx, draftId: string | undefined, opts: ComposeOpts & { at?: string }): Promise<void> {
  const sendAt = opts.at === undefined ? undefined : parseFuture(opts.at, ctx.now);
  let id: number;
  if (draftId !== undefined) {
    if (opts.to?.length || opts.body !== undefined || opts.bodyFile !== undefined) throw new FlintError("invalid", "Give a draft id, or --to and --body, not both.");
    id = parseId(draftId, "draft id");
  } else {
    if (!opts.to?.length) throw new FlintError("invalid", "Give a draft id, or --to, --subject and --body.");
    id = (await newDraft(ctx, opts)).id;
  }
  const result = await ctx.client.sendDraft(id, sendAt === undefined ? undefined : { sendAt });
  emit(ctx, result, (r) => {
    if (r.status === "awaiting_approval") return `Draft ${id} is waiting for your approval. Open Agent Activity in Flint to approve it.`;
    if (r.status === "failed" || r.status === "cancelled") return `Draft ${id} was not sent (${r.status}).`;
    return `Queued draft ${id}. It sends at ${formatFull(r.sendAt)}.`;
  });
}
