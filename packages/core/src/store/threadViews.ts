import { ARCHIVE_PREDICATE, roleMember, type SqlFragment } from "../search";
import type { Category, ThreadQuery } from "../types";
import { Sql } from "./sql";

/** Predicate over messages `m` and threads `t` that selects the messages a view shows, never including aggregate state. */
export type ViewWhere = SqlFragment;

const addr = "lower(json_extract(m.from_json, '$[0].address'))";

/** SQL for "sender matches a blocked pattern", or null when nothing is blocked (so the clause costs nothing). */
export function blockedClause(patterns: ReadonlySet<string>): SqlFragment | null {
  if (patterns.size === 0) return null;
  const exact = [...patterns].filter((p) => !p.startsWith("@"));
  const domains = [...patterns].filter((p) => p.startsWith("@"));
  const parts: string[] = [];
  const params: string[] = [];
  if (exact.length) { parts.push(`${addr} IN (${Sql.marks(exact.length)})`); params.push(...exact); }
  if (domains.length) { parts.push(`substr(${addr}, instr(${addr}, '@')) IN (${Sql.marks(domains.length)})`); params.push(...domains); }
  return { sql: `(${parts.join(" OR ")})`, params };
}

/** True for a server Drafts copy that a local draft stands behind (matched by Message-ID, or by UID in the Drafts folder). */
export const COVERED_BY_LOCAL_DRAFT = `EXISTS (SELECT 1 FROM drafts xd WHERE xd.account_id = m.account_id AND (
  (xd.server_message_id IS NOT NULL AND xd.server_message_id = m.message_id)
  OR (xd.server_uid IS NOT NULL AND xd.server_uid = m.uid AND m.folder_id IN (SELECT xdf.id FROM folders xdf WHERE xdf.role = 'drafts'))))`;

const notTrashOrSpam = `NOT ${roleMember("trash")} AND NOT ${roleMember("spam")}`;

/** Base predicate for a view, without account, category, unread or search filters. Returns null when the view can never match anything. */
export function viewPredicate(query: ThreadQuery, now: number, blocked: ReadonlySet<string>): ViewWhere | null {
  const blockedSql = blockedClause(blocked);
  switch (query.view) {
    case "inbox": {
      const parts = [roleMember("inbox"), "(t.snoozed_until IS NULL OR t.snoozed_until <= ?)"];
      const params: (string | number)[] = [now];
      if (blockedSql) { parts.push(`NOT ${blockedSql.sql}`); params.push(...blockedSql.params); }
      return { sql: parts.join(" AND "), params };
    }
    case "sent": return { sql: roleMember("sent"), params: [] };
    case "drafts": return { sql: `${roleMember("drafts")} AND NOT ${COVERED_BY_LOCAL_DRAFT}`, params: [] };
    case "trash": return { sql: roleMember("trash"), params: [] };
    case "spam": return { sql: roleMember("spam"), params: [] };
    case "archive": return { sql: ARCHIVE_PREDICATE, params: [] };
    case "pinned": return { sql: `t.pinned = 1 AND ${notTrashOrSpam}`, params: [] };
    case "snoozed": return { sql: `t.snoozed_until IS NOT NULL AND t.snoozed_until > ? AND ${notTrashOrSpam}`, params: [now] };
    case "folder":
      return query.folderId === undefined ? null : { sql: "m.id IN (SELECT xf.message_id FROM message_folders xf WHERE xf.folder_id = ?)", params: [query.folderId] };
    case "blocked":
      return blockedSql ? { sql: `${roleMember("trash")} AND ${blockedSql.sql}`, params: blockedSql.params } : null;
    case "search":
      return { sql: "1=1", params: [] };
  }
}

/** Focused inbox: people threads only, or one bundle's category. Only applies to the inbox view. */
export function categoryClause(query: ThreadQuery): { category: Category } | null {
  if (query.view !== "inbox") return null;
  if (query.category) return { category: query.category };
  if (query.focused) return { category: "people" };
  return null;
}
