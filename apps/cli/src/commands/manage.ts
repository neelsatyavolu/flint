import { emit, parseId, parseLimit, resolveAccountId, type Ctx } from "../ctx";
import { renderTable } from "../table";
import { formatAddresses } from "../text";
import { formatFull, formatShort } from "../time";

export async function attachment(ctx: Ctx, idRaw: string): Promise<void> {
  const path = await ctx.client.saveAttachment(parseId(idRaw, "attachment id"));
  emit(ctx, { path }, (r) => `Saved to ${r.path}`);
}

export async function cancel(ctx: Ctx, idRaw: string): Promise<void> {
  const id = parseId(idRaw, "scheduled id");
  const d = await ctx.client.cancelSend(id);
  emit(ctx, d, (x) => `Cancelled send ${id}. Draft ${x.id} is kept; send it again with: flint send ${x.id}`);
}

export async function undo(ctx: Ctx, token: string): Promise<void> {
  await ctx.client.undo(token);
  emit(ctx, { ok: true }, () => "Undone.");
}

export async function unsubscribe(ctx: Ctx, idRaw: string): Promise<void> {
  const r = await ctx.client.unsubscribe(parseId(idRaw, "message id"));
  const how = { one_click: "Unsubscribed (one-click request sent).", mailto: "Unsubscribe email sent.", browser: "Opened the unsubscribe page in your browser; finish it there." };
  emit(ctx, r, (x) => how[x.method]);
}

export async function block(ctx: Ctx, pattern: string, on: boolean): Promise<void> {
  if (on) await ctx.client.blockSender(pattern);
  else await ctx.client.unblockSender(pattern);
  emit(ctx, { pattern, blocked: on }, () => `${on ? "Blocked" : "Unblocked"} ${pattern}.`);
}

export async function blocked(ctx: Ctx): Promise<void> {
  const rows = await ctx.client.listBlocked();
  emit(ctx, rows, (l) => l.length === 0 ? "No blocked senders." : renderTable(
    ["PATTERN", "BLOCKED"], l.map((b) => [b.pattern, formatShort(b.createdAt, ctx.now)]), { width: ctx.width, style: ctx.style },
  ));
}

export async function folders(ctx: Ctx, opts: { account?: string }): Promise<void> {
  const only = await resolveAccountId(ctx, opts.account);
  const accounts = (await ctx.client.listAccounts()).filter((a) => only === undefined || a.id === only);
  const rows = (await Promise.all(accounts.map(async (a) => (await ctx.client.listFolders(a.id)).map((f) => ({ ...f, account: a.email }))))).flat();
  emit(ctx, rows, (l) => l.length === 0 ? "No folders." : renderTable(
    ["ID", "ACCOUNT", "NAME", "ROLE", "UNREAD"], l.map((f) => [String(f.id), f.account, f.name, f.role ?? "", String(f.unread)]),
    { width: ctx.width, style: ctx.style },
  ));
}

export async function drafts(ctx: Ctx): Promise<void> {
  const rows = await ctx.client.listDrafts();
  emit(ctx, rows, (l) => l.length === 0 ? "No drafts." : renderTable(
    ["ID", "TO", "SUBJECT"], l.map((d) => [String(d.id), formatAddresses(d.to), d.subject || "(none)"]), { width: ctx.width, style: ctx.style },
  ));
}

export async function deleteDraft(ctx: Ctx, idRaw: string): Promise<void> {
  const id = parseId(idRaw, "draft id");
  await ctx.client.deleteDraft(id);
  emit(ctx, { deleted: id }, () => `Deleted draft ${id}.`);
}

export async function queue(ctx: Ctx): Promise<void> {
  const rows = await ctx.client.listScheduled();
  emit(ctx, rows, (l) => l.length === 0 ? "Nothing queued." : renderTable(
    ["ID", "DRAFT", "SENDS", "STATUS", "TO", "SUBJECT"],
    l.map((s) => [String(s.id), String(s.draftId), formatFull(s.sendAt), s.status, formatAddresses(s.to), s.subject]),
    { width: ctx.width, style: ctx.style },
  ));
}

export async function contacts(ctx: Ctx, prefix: string, opts: { limit?: string }): Promise<void> {
  const rows = await ctx.client.suggestContacts(prefix, parseLimit(opts.limit, 10));
  emit(ctx, rows, (l) => l.length === 0 ? "No contacts." : renderTable(
    ["EMAIL", "NAME"], l.map((c) => [c.email, c.name]), { width: ctx.width, style: ctx.style },
  ));
}
