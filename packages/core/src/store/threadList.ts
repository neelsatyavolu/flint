import { buildSearchWhere, isEmptySearch, parseSearch, roleMember } from "../search";
import { logger } from "../log";
import { FlintError, type Address, type Bundle, type ThreadId, type ThreadListItem, type ThreadPage, type ThreadQuery } from "../types";
import type { AccountsRepo } from "./accounts";
import { addresses, asCategory, lowerAddr } from "./mappers";
import type { ReceiptsRepo } from "./receipts";
import type { RulesRepo } from "./rulesRepo";
import { bool, Sql, type Param } from "./sql";
import { localDraftEntries } from "./draftList";
import { categoryClause, viewPredicate } from "./threadViews";

const log = logger("store.threads");
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;
const DRAFTS_SCAN_LIMIT = 100_000;

type Where = { sql: string; params: Param[] };
type MsgRow = { id: number; thread_id: number; from_json: string; date: number; seen: number; draft: number; has_attachments: number; snippet: string };
type ThreadRow = { id: number; account_id: string; subject: string; category: string; pinned: number; muted: number; snoozed_until: number | null; resurfaced_at: number | null };

const KEY = "MAX(MAX(m.date), COALESCE(t.resurfaced_at, 0))";

export function encodeCursor(key: number, id: number): string {
  return Buffer.from(JSON.stringify([key, id])).toString("base64url");
}

export function decodeCursor(cursor: string): [number, number] {
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number") return [v[0], v[1]];
  } catch { /* fall through */ }
  throw new FlintError("invalid", "That page marker is no longer valid. Reload the list.");
}

export class ThreadListRepo {
  constructor(protected q: Sql, private accounts: AccountsRepo, private receipts: ReceiptsRepo, private rulesRepo: RulesRepo) {}

  /** ThreadQuery -> ThreadPage (see types.ts). Search input that cannot be parsed or run yields an empty page, never an error. */
  listThreads(query: ThreadQuery, now: number = Date.now()): ThreadPage {
    const empty: ThreadPage = { items: [], bundles: [], nextCursor: null };
    const limit = Math.max(1, Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
    if (query.view === "drafts") return this.#listDrafts(query, limit, now);
    const where = this.#buildWhere(query, now);
    if (!where) return empty;
    try {
      const rows = this.#pageRows(where, query, limit);
      const page = rows.slice(0, limit);
      const items = this.#hydrate(page.map((r) => r.id), where);
      const last = page[page.length - 1];
      return {
        items,
        bundles: query.focused && query.view === "inbox" && !query.category ? this.#bundles(query, now) : [],
        nextCursor: rows.length > limit && last ? encodeCursor(last.k, last.id) : null,
      };
    } catch (error) {
      if (error instanceof FlintError) throw error;
      if (query.view !== "search") throw error;
      log.warn("search failed", { message: (error as Error).message });
      return empty;
    }
  }

  /** List items for specific threads (home screen). Counts and snippets cover messages outside trash and spam. Input order is kept. */
  itemsForThreads(ids: ThreadId[]): ThreadListItem[] {
    if (ids.length === 0) return [];
    const where: Where = { sql: `NOT ${roleMember("trash")} AND NOT ${roleMember("spam")}`, params: [] };
    const items = this.#hydrate(ids, where);
    const byId = new Map(items.map((i) => [i.id, i]));
    return ids.map((id) => byId.get(id)).filter((i): i is ThreadListItem => i !== undefined);
  }

  /**
   * The Drafts view: every local draft plus the server Drafts copies no local draft stands behind, newest first. Drafts are few,
   * so both sets are read whole, merged and paged here. Local rows without a thread carry the negative id of their draft.
   */
  #listDrafts(query: ThreadQuery, limit: number, now: number): ThreadPage {
    const page: ThreadPage = { items: [], bundles: [], nextCursor: null };
    if (query.unreadOnly) return page;
    const server = this.#buildWhere({ ...query, cursor: undefined }, now);
    const serverRows = server ? this.#pageRows(server, { ...query, cursor: undefined, unreadOnly: false }, DRAFTS_SCAN_LIMIT) : [];
    const serverItems = new Map(
      (server ? this.#hydrate(serverRows.map((r) => r.id), server) : []).map((i) => [i.id, this.#withServerDraft(i, server!)]),
    );
    const entries = [
      ...localDraftEntries(this.q, query.accountId),
      ...serverRows.flatMap((r) => { const item = serverItems.get(r.id); return item ? [{ key: r.k, id: r.id, item }] : []; }),
    ];
    const asc = query.sort === "oldest";
    entries.sort((a, b) => (asc ? a.key - b.key || a.id - b.id : b.key - a.key || b.id - a.id));
    const after = query.cursor ? decodeCursor(query.cursor) : null;
    const rest = after ? entries.filter((e) => (asc ? e.key > after[0] || (e.key === after[0] && e.id > after[1]) : e.key < after[0] || (e.key === after[0] && e.id < after[1]))) : entries;
    const shown = rest.slice(0, limit);
    const last = shown[shown.length - 1];
    return { ...page, items: shown.map((e) => e.item), nextCursor: rest.length > limit && last ? encodeCursor(last.key, last.id) : null };
  }

  /** A server draft row lists its recipients and names the message to open. */
  #withServerDraft(item: ThreadListItem, where: Where): ThreadListItem {
    const m = this.q.get<{ id: number; to_json: string; cc_json: string }>(
      `SELECT m.id, m.to_json, m.cc_json FROM messages m JOIN threads t ON t.id = m.thread_id
       WHERE m.thread_id = ? AND ${where.sql} ORDER BY m.date DESC, m.id DESC LIMIT 1`, item.id, ...where.params);
    if (!m) return item;
    const people = [...addresses(m.to_json), ...addresses(m.cc_json)];
    return { ...item, participants: people, draft: { draftId: null, messageId: m.id } };
  }

  // ---- query building

  #buildWhere(query: ThreadQuery, now: number): Where | null {
    const base = viewPredicate(query, now, query.view === "inbox" || query.view === "blocked" ? this.rulesRepo.blockedPatterns() : new Set());
    if (!base) return null;
    const parts: string[] = [base.sql];
    const params: Param[] = [...base.params];
    if (query.view === "search") {
      const parsed = parseSearch(query.search ?? "");
      if (isEmptySearch(parsed)) return null;
      const s = buildSearchWhere(parsed, now);
      parts.push(s.sql);
      params.push(...s.params);
      if (s.excludeTrashSpam) parts.push(`NOT ${roleMember("trash")} AND NOT ${roleMember("spam")}`);
    }
    if (query.accountId) { parts.push("m.account_id = ?"); params.push(query.accountId); }
    const cat = categoryClause(query);
    if (cat) { parts.push("t.category = ?"); params.push(cat.category); }
    return { sql: parts.map((p) => `(${p})`).join(" AND "), params };
  }

  #pageRows(where: Where, query: ThreadQuery, limit: number): { id: number; k: number }[] {
    const asc = query.sort === "oldest";
    const having: string[] = [];
    const params: Param[] = [...where.params];
    if (query.unreadOnly) having.push("SUM(m.seen = 0 AND m.draft = 0) > 0");
    if (query.cursor) {
      const [k, id] = decodeCursor(query.cursor);
      const [cmp] = asc ? [">"] : ["<"];
      having.push(`(${KEY} ${cmp} ? OR (${KEY} = ? AND t.id ${cmp} ?))`);
      params.push(k, k, id);
    }
    const dir = asc ? "ASC" : "DESC";
    return this.q.all<{ id: number; k: number }>(
      `SELECT t.id AS id, ${KEY} AS k FROM messages m JOIN threads t ON t.id = m.thread_id
       WHERE ${where.sql} GROUP BY t.id ${having.length ? `HAVING ${having.join(" AND ")}` : ""}
       ORDER BY k ${dir}, t.id ${dir} LIMIT ?`,
      ...params, limit + 1,
    );
  }

  // ---- hydration

  #hydrate(ids: ThreadId[], where: Where): ThreadListItem[] {
    if (ids.length === 0) return [];
    const marks = Sql.marks(ids.length);
    const threads = new Map(this.q.all<ThreadRow>(`SELECT * FROM threads WHERE id IN (${marks})`, ...ids).map((t) => [t.id, t]));
    const msgs = this.q.all<MsgRow>(
      `SELECT m.id, m.thread_id, m.from_json, m.date, m.seen, m.draft, m.has_attachments, m.snippet
       FROM messages m JOIN threads t ON t.id = m.thread_id
       WHERE m.thread_id IN (${marks}) AND ${where.sql} ORDER BY m.thread_id, m.date, m.id`,
      ...ids, ...where.params,
    );
    const byThread = new Map<number, MsgRow[]>();
    for (const m of msgs) {
      const list = byThread.get(m.thread_id);
      if (list) list.push(m); else byThread.set(m.thread_id, [m]);
    }
    const drafts = new Set([
      ...this.q.all<{ thread_id: number }>(`SELECT DISTINCT thread_id FROM drafts WHERE thread_id IN (${marks})`, ...ids).map((r) => r.thread_id),
      ...this.q.all<{ thread_id: number }>(`SELECT DISTINCT thread_id FROM messages WHERE thread_id IN (${marks}) AND draft = 1`, ...ids).map((r) => r.thread_id),
    ]);
    const own = this.accounts.ownAddresses();
    const receipts = this.receipts.summariesForThreads(ids, own);
    const items: ThreadListItem[] = [];
    for (const id of ids) {
      const t = threads.get(id);
      const all = byThread.get(id);
      if (!t || !all?.length) continue;
      // Server drafts are not part of the conversation: hide them unless the thread has nothing else in this view.
      const list = all.some((m) => m.draft === 0) ? all.filter((m) => m.draft === 0) : all;
      const latest = list[list.length - 1]!;
      items.push({
        id, accountId: t.account_id, subject: t.subject, snippet: latest.snippet, participants: participants(list, own),
        lastDate: Math.max(latest.date, t.resurfaced_at ?? 0), messageCount: list.length, unreadCount: list.filter((m) => m.seen === 0 && m.draft === 0).length,
        hasAttachments: list.some((m) => m.has_attachments === 1), pinned: bool(t.pinned), muted: bool(t.muted),
        snoozedUntil: t.snoozed_until, category: asCategory(t.category) ?? "people", hasDraft: drafts.has(id), receipt: receipts.get(id) ?? null,
      });
    }
    return items;
  }

  // ---- bundles

  #bundles(query: ThreadQuery, now: number): Bundle[] {
    const where = this.#buildWhere({ ...query, focused: false, category: undefined, cursor: undefined, unreadOnly: false }, now);
    if (!where) return [];
    const rows = this.q.all<{ id: number; category: string; k: number; unread: number }>(
      `SELECT t.id AS id, t.category AS category, ${KEY} AS k, SUM(m.seen = 0 AND m.draft = 0) AS unread
       FROM messages m JOIN threads t ON t.id = m.thread_id
       WHERE ${where.sql} AND t.category <> 'people' GROUP BY t.id ORDER BY k DESC, t.id DESC`,
      ...where.params,
    );
    const out: Bundle[] = [];
    for (const category of ["notifications", "newsletters"] as const) {
      const mine = rows.filter((r) => r.category === category);
      if (mine.length === 0) continue;
      out.push({
        category, unreadCount: mine.filter((r) => r.unread > 0).length, totalCount: mine.length, lastDate: mine[0]!.k,
        latest: mine.slice(0, 3).map((r) => this.#latestOf(r.id, where)),
      });
    }
    return out;
  }

  #latestOf(threadId: ThreadId, where: Where): { from: Address; subject: string } {
    const r = this.q.get<{ from_json: string; subject: string }>(
      `SELECT m.from_json, m.subject FROM messages m JOIN threads t ON t.id = m.thread_id
       WHERE m.thread_id = ? AND ${where.sql} ORDER BY m.date DESC, m.id DESC LIMIT 1`, threadId, ...where.params,
    );
    return { from: addresses(r?.from_json)[0] ?? { name: "", address: "" }, subject: r?.subject ?? "" };
  }
}

/** Distinct senders in message order, most recent last. The user's own addresses show as "me". */
export function participants(list: Pick<MsgRow, "from_json">[], own: ReadonlySet<string>): Address[] {
  const seen = new Map<string, Address>();
  for (const m of list) {
    const a = addresses(m.from_json)[0];
    if (!a) continue;
    const key = lowerAddr(a);
    seen.delete(key);
    seen.set(key, own.has(key) ? { name: "me", address: a.address } : a);
  }
  return [...seen.values()];
}
