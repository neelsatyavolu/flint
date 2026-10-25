import type { Address, Bundle, MessageView, ThreadListItem, ThreadPage, ThreadQuery } from "@flint/core";
import type { MThread, MockState } from "./state";
import { liveDrafts, plainSnippet, stripHtml } from "./state";

const ME_ADDRESS = (state: MockState, t: MThread) => state.accounts.find((a) => a.id === t.accountId)?.email ?? "";

export const unreadCount = (t: MThread) => t.messages.filter((m) => !m.seen && !m.isFromMe).length;

export function lastDate(state: MockState, t: MThread): number {
  const last = t.messages.at(-1)?.date ?? 0;
  const draft = t.draftIds.length ? Math.max(...state.drafts.filter((d) => t.draftIds.includes(d.id)).map((d) => d.updatedAt)) : 0;
  return Math.max(last, t.resurfacedAt ?? 0, t.messages.length === 0 ? draft : 0);
}

function participants(state: MockState, t: MThread): Address[] {
  const list: Address[] = [];
  for (const m of t.messages) {
    const sender = m.isFromMe ? { name: "me", address: ME_ADDRESS(state, t) } : m.from[0];
    if (!sender) continue;
    const i = list.findIndex((a) => a.address.toLowerCase() === sender.address.toLowerCase());
    if (i >= 0) list.splice(i, 1);
    list.push(sender);
  }
  if (list.length === 0) list.push({ name: "me", address: ME_ADDRESS(state, t) });
  return list;
}

export function toListItem(state: MockState, t: MThread): ThreadListItem {
  const lastSent = [...t.messages].reverse().find((m) => m.isFromMe);
  const lastMsg = t.messages.at(-1);
  const draft = state.drafts.find((d) => t.draftIds.includes(d.id));
  const tracked = lastSent?.receipt ? state.tracked.find((x) => x.trackedId === lastSent.receipt!.trackedId) : undefined;
  return {
    id: t.id, accountId: t.accountId, subject: t.subject,
    snippet: lastMsg ? lastMsg.snippet : plainSnippet(stripHtml(draft?.html ?? "")),
    participants: participants(state, t), lastDate: lastDate(state, t), messageCount: Math.max(1, t.messages.length),
    unreadCount: unreadCount(t), hasAttachments: t.messages.some((m) => m.attachments.length > 0), pinned: t.pinned, muted: t.muted,
    snoozedUntil: t.snoozedUntil, category: t.category, hasDraft: t.draftIds.length > 0, receipt: tracked?.summary ?? null,
  };
}

type SearchTerms = { include: string[]; exclude: string[]; ops: Record<string, string[]> };

export function parseSearch(q: string): SearchTerms {
  const terms: SearchTerms = { include: [], exclude: [], ops: {} };
  const re = /(-?)(?:(\w+):)?(?:"([^"]*)"|(\S+))/g;
  for (const m of q.matchAll(re)) {
    const neg = m[1] === "-";
    const op = m[2]?.toLowerCase();
    const val = (m[3] ?? m[4] ?? "").toLowerCase();
    if (!val) continue;
    if (op) (terms.ops[op] ??= []).push(val);
    else (neg ? terms.exclude : terms.include).push(val);
  }
  return terms;
}

const addrText = (list: Address[]) => list.map((a) => `${a.name} ${a.address}`).join(" ").toLowerCase();

export function matchesSearch(state: MockState, t: MThread, terms: SearchTerms): boolean {
  const msgs: MessageView[] = t.messages;
  const hay = `${t.subject} ${msgs.map((m) => `${addrText(m.from)} ${addrText(m.to)} ${m.snippet} ${m.text ?? ""}`).join(" ")}`.toLowerCase();
  if (!terms.include.every((w) => hay.includes(w))) return false;
  if (terms.exclude.some((w) => hay.includes(w))) return false;
  const { ops } = terms;
  if (ops.from && !ops.from.every((v) => msgs.some((m) => addrText(m.from).includes(v)))) return false;
  if (ops.to && !ops.to.every((v) => msgs.some((m) => addrText(m.to).includes(v)))) return false;
  if (ops.cc && !ops.cc.every((v) => msgs.some((m) => addrText(m.cc).includes(v)))) return false;
  if (ops.subject && !ops.subject.every((v) => t.subject.toLowerCase().includes(v))) return false;
  if (ops.account && !ops.account.every((v) => ME_ADDRESS(state, t).toLowerCase().includes(v))) return false;
  if (ops.has?.includes("attachment") && !msgs.some((m) => m.attachments.length)) return false;
  for (const flag of ops.is ?? []) {
    if (flag === "unread" && unreadCount(t) === 0) return false;
    if (flag === "read" && unreadCount(t) > 0) return false;
    if (flag === "pinned" && !t.pinned) return false;
    if (flag === "snoozed" && t.snoozedUntil === null) return false;
  }
  for (const v of ops.before ?? []) if (lastDate(state, t) >= Date.parse(v)) return false;
  for (const v of ops.after ?? []) if (lastDate(state, t) < Date.parse(v)) return false;
  for (const v of ops.in ?? []) {
    const folder = state.folders.find((f) => t.folderIds.includes(f.id) && f.name.toLowerCase() === v);
    const loc = t.location === v || (v === "sent" && msgs.some((m) => m.isFromMe)) || (v === "drafts" && t.draftIds.length > 0);
    if (!folder && !loc) return false;
  }
  return true;
}

function inView(state: MockState, t: MThread, q: ThreadQuery, now: number): boolean {
  const snoozed = t.snoozedUntil !== null && t.snoozedUntil > now;
  switch (q.view) {
    case "inbox": return t.location === "inbox" && !t.blocked && !snoozed;
    case "pinned": return t.pinned && t.location !== "trash" && t.location !== "spam";
    case "drafts": return liveDrafts(state).some((d) => t.draftIds.includes(d.id));
    case "sent": return t.messages.some((m) => m.isFromMe) && t.location !== "trash" && t.location !== "spam";
    case "trash": return t.location === "trash" && !t.blocked;
    case "spam": return t.location === "spam";
    case "archive": return t.location === "archive";
    case "snoozed": return snoozed && t.location !== "trash";
    case "folder": return q.folderId !== undefined && t.folderIds.includes(q.folderId);
    case "blocked": return t.blocked;
    case "search": return t.location !== "trash" && t.location !== "spam" && matchesSearch(state, t, parseSearch(q.search ?? ""));
  }
}

function bundles(state: MockState, threads: MThread[]): Bundle[] {
  return (["notifications", "newsletters"] as const).map((category) => {
    const list = threads.filter((t) => t.category === category).sort((a, b) => lastDate(state, b) - lastDate(state, a));
    return {
      category, unreadCount: list.filter((t) => unreadCount(t) > 0).length, totalCount: list.length, lastDate: list[0] ? lastDate(state, list[0]) : 0,
      latest: list.slice(0, 3).map((t) => ({ from: t.messages.at(-1)?.from[0] ?? { name: "", address: "" }, subject: t.subject })),
    };
  }).filter((b) => b.totalCount > 0);
}

/** Server-side mail that is older than the window, newest first. */
export const sortedOlder = (state: MockState, accountId?: string): MThread[] =>
  state.older.filter((t) => (accountId ? t.accountId === accountId : true)).sort((a, b) => lastDate(state, b) - lastDate(state, a));

/** Accounts the user turned off for the unified inbox. All-accounts views leave their mail out. */
export const hiddenAccounts = (state: MockState): Set<string> => new Set(state.accounts.filter((a) => !a.showInUnified).map((a) => a.id));

export function queryThreads(state: MockState, q: ThreadQuery, now: number): ThreadPage {
  const hidden = hiddenAccounts(state);
  const allAccounts = !q.accountId && q.view !== "folder" && q.view !== "blocked";
  let list = state.threads.filter((t) => (q.accountId ? t.accountId === q.accountId : true) && !(allAccounts && hidden.has(t.accountId)) && inView(state, t, q, now));
  const bundled = q.view === "inbox" && q.focused ? bundles(state, list) : [];
  if (q.view === "inbox" && q.category) list = list.filter((t) => t.category === q.category);
  else if (q.view === "inbox" && q.focused) list = list.filter((t) => t.category === "people");
  if (q.unreadOnly) list = list.filter((t) => unreadCount(t) > 0);
  const dir = q.sort === "oldest" ? 1 : -1;
  list = [...list].sort((a, b) => dir * (lastDate(state, a) - lastDate(state, b)));
  const limit = Math.min(200, q.limit ?? 50);
  const start = q.cursor ? Number(q.cursor) || 0 : 0;
  const slice = list.slice(start, start + limit);
  const end = start + slice.length;
  const nextCursor = end < list.length ? String(end) : null;
  const olderLeft = q.view === "inbox" && state.older.some((t) => (q.accountId ? t.accountId === q.accountId : true));
  return { items: slice.map((t) => (q.view === "drafts" ? { ...toListItem(state, t), draft: { draftId: t.draftIds[0] ?? null, messageId: null } } : toListItem(state, t))), bundles: bundled, nextCursor, ...(nextCursor === null ? { olderOnServer: olderLeft } : {}) };
}
