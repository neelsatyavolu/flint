import { emit, parseId, parseLimit, type Ctx } from "../ctx";
import { renderTable } from "../table";
import { formatFull, formatShort } from "../time";

export async function status(ctx: Ctx): Promise<void> {
  const [sync, sidebar] = await Promise.all([ctx.client.getSyncStatus(), ctx.client.getSidebar()]);
  emit(ctx, { running: true, sync, counts: sidebar.counts }, () => {
    const emails = new Map(sidebar.accounts.map((a) => [a.account.id, a.account.email]));
    const c = sidebar.counts;
    const lines = ["Flint is running."];
    for (const s of sync) {
      const last = s.lastSyncAt ? `, last sync ${formatShort(s.lastSyncAt, ctx.now)}` : "";
      lines.push(`${emails.get(s.accountId) ?? s.accountId}  ${s.state}${last}${s.error ? ` (${s.error})` : ""}`);
    }
    lines.push(`Inbox ${c.inbox} unread, pinned ${c.pinned}, drafts ${c.drafts}, snoozed ${c.snoozed}, scheduled ${c.scheduled}, awaiting approval ${c.awaitingApproval}`);
    return lines.join("\n");
  });
}

export async function accounts(ctx: Ctx): Promise<void> {
  const list = await ctx.client.listAccounts();
  emit(ctx, list, (l) => l.length === 0 ? "No accounts. Add one in Flint." : renderTable(
    ["ID", "EMAIL", "NAME", "PROVIDER", "ENABLED"],
    l.map((a) => [a.id, a.email, a.name, a.provider, a.enabled ? "yes" : "no"]),
    { width: ctx.width, style: ctx.style },
  ));
}

export async function receipts(ctx: Ctx, idRaw: string | undefined, opts: { limit?: string }): Promise<void> {
  if (idRaw !== undefined) {
    const r = await ctx.client.getReceipt(parseId(idRaw, "tracked id"));
    return emit(ctx, r, (d) => {
      const table = renderTable(
        ["TO", "STATUS", "OPENS", "FIRST OPEN", "NOTE"],
        d.recipients.map((x) => [x.email, x.status, String(x.openCount), x.firstOpenAt ? formatFull(x.firstOpenAt) : "", x.possiblyForwarded ? "may have been forwarded" : (x.note ?? "")]),
        { width: ctx.width, style: ctx.style },
      );
      return `Sent ${formatFull(d.sentAt)}\n${table}`;
    });
  }
  const list = await ctx.client.listTracked({ limit: parseLimit(opts.limit, 25) });
  emit(ctx, list, (l) => l.length === 0 ? "No tracked mail." : renderTable(
    ["ID", "SENT", "STATUS", "OPENED", "SUBJECT"],
    l.map((t) => [String(t.trackedId), formatShort(t.sentAt, ctx.now), t.summary.status, `${t.summary.opened}/${t.summary.total}`, t.subject]),
    { width: ctx.width, style: ctx.style },
  ));
}

export async function summarize(ctx: Ctx, idRaw: string): Promise<void> {
  const r = await ctx.client.aiRunToText({ kind: "summarize", threadId: parseId(idRaw) });
  emit(ctx, r, (x) => x.text);
}

export async function ask(ctx: Ctx, question: string): Promise<void> {
  const r = await ctx.client.aiRunToText({ kind: "ask", question });
  emit(ctx, r, (x) => x.text);
}

export async function watch(ctx: Ctx): Promise<void> {
  for await (const event of ctx.client.events()) ctx.out(JSON.stringify(event));
}

export async function activity(ctx: Ctx, opts: { limit?: string }): Promise<void> {
  const rows = await ctx.client.listAgentActivity({ limit: parseLimit(opts.limit, 20) });
  emit(ctx, rows, (l) => l.length === 0 ? "No agent activity yet." : renderTable(
    ["ID", "TIME", "AGENT", "STATUS", "SUMMARY"],
    l.map((a) => [String(a.id), formatShort(a.at, ctx.now), a.agent, a.status, a.summary]),
    { width: ctx.width, style: ctx.style },
  ));
}
