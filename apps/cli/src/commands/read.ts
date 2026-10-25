import type { Category, ThreadListItem, ThreadQuery } from "@flint/core/types";
import { FlintError } from "@flint/core/types";
import { emit, parseId, parseLimit, plural, resolveAccountId, type Ctx } from "../ctx";
import { renderTable } from "../table";
import { parseSearch } from "@flint/core/search/parse";
import { formatAddresses, messageBody } from "../text";
import { formatFull, formatShort } from "../time";

const VIEWS = ["inbox", "pinned", "sent", "drafts", "archive", "trash", "spam", "snoozed"] as const;
const CATEGORIES: Category[] = ["people", "notifications", "newsletters"];

export type ListOpts = { view?: string; account?: string; unread?: boolean; focused?: boolean; category?: string; limit?: string };

function who(t: ThreadListItem): string {
  const names = [...new Set(t.participants.map((p) => p.name || p.address))];
  return names.slice(-2).join(", ");
}

export function threadTable(ctx: Ctx, items: ThreadListItem[]): string {
  if (items.length === 0) return "No threads.";
  const rows = items.map((t) => [
    String(t.id),
    `${t.unreadCount > 0 ? "*" : " "}${t.pinned ? "p" : " "}${t.hasAttachments ? "+" : " "}`,
    formatShort(t.lastDate, ctx.now),
    who(t),
    t.messageCount > 1 ? `${t.subject} (${t.messageCount})` : t.subject,
  ]);
  return renderTable(["ID", "", "DATE", "FROM", "SUBJECT"], rows, {
    width: ctx.width, style: ctx.style, bold: (i) => (items[i]?.unreadCount ?? 0) > 0,
  });
}

export async function list(ctx: Ctx, opts: ListOpts): Promise<void> {
  const view = opts.view ?? "inbox";
  if (!(VIEWS as readonly string[]).includes(view)) throw new FlintError("invalid", `Unknown view "${view}". Use ${VIEWS.join(", ")}.`);
  if (opts.category && !CATEGORIES.includes(opts.category as Category)) throw new FlintError("invalid", `Unknown category "${opts.category}". Use ${CATEGORIES.join(", ")}.`);
  const query: ThreadQuery = {
    view: view as ThreadQuery["view"],
    accountId: await resolveAccountId(ctx, opts.account),
    unreadOnly: opts.unread || undefined,
    focused: opts.focused || undefined,
    category: opts.category as Category | undefined,
    limit: parseLimit(opts.limit, 25),
  };
  const page = await ctx.client.listThreads(query);
  emit(ctx, page, (p) => threadTable(ctx, p.items));
}

const OPERATORS = "from:, to:, cc:, subject:, in:, account:, has:attachment, is:unread|read|pinned|snoozed, before:YYYY-MM-DD, after:YYYY-MM-DD";

/** Bare words that look like operators the search does not understand, so an agent can tell "no match" from "ignored". */
export function unrecognizedOperators(query: string): string[] {
  return parseSearch(query).terms
    .filter((t) => !t.phrase && /^[a-z][a-z-]*:[^/\s]/i.test(t.text))
    .map((t) => `${t.negated ? "-" : ""}${t.text}`);
}

export async function search(ctx: Ctx, query: string, opts: { limit?: string; server?: boolean }): Promise<void> {
  if (!query.trim()) throw new FlintError("invalid", `Give a search query. Supported: ${OPERATORS}.`);
  const unknown = unrecognizedOperators(query);
  if (unknown.length) ctx.warn(`Warning: not a search operator, treated as plain text: ${unknown.join(", ")}. Supported: ${OPERATORS}.`);
  if (opts.server) {
    const found = await ctx.client.searchServer(query);
    if (found.added > 0) ctx.warn(`Fetched ${plural(found.added, "older message")} from the mail server.`);
  }
  const page = await ctx.client.listThreads({ view: "search", search: query, limit: parseLimit(opts.limit, 25) });
  emit(ctx, page, (p) => threadTable(ctx, p.items));
}

export async function read(ctx: Ctx, idRaw: string, opts: { raw?: boolean }): Promise<void> {
  const thread = await ctx.client.getThread(parseId(idRaw));
  emit(ctx, thread, (t) => {
    const parts = [ctx.style.bold(t.subject || "(no subject)"), ctx.style.dim(`thread ${t.id}, ${plural(t.messages.length, "message")}`)];
    for (const m of t.messages) {
      const head = [`Message ${m.id}`, `From: ${formatAddresses(m.from)}`, `To: ${formatAddresses(m.to)}`];
      if (m.cc.length) head.push(`Cc: ${formatAddresses(m.cc)}`);
      head.push(`Date: ${formatFull(m.date)}`);
      if (m.attachments.length) head.push(`Attachments: ${m.attachments.map((a) => `${a.filename} (${Math.max(1, Math.round(a.size / 1024))} KB, attachment ${a.id})`).join(", ")}`);
      parts.push("", ctx.style.dim("-".repeat(Math.min(ctx.width, 60))), head.join("\n"), "", messageBody(m, opts.raw === true));
    }
    return parts.join("\n");
  });
}
