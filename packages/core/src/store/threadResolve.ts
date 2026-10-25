import {
  cleanMessageId, hasParentLink, isAutomatedHeaders, isGenericSubject, joinSubject, linkedIds, participantSet, sharesParticipant, SUBJECT_JOIN_WINDOW_MS, threadKeyFor,
} from "../threading";
import type { AccountId, Address, ThreadId } from "../types";
import { addresses } from "./mappers";
import { chunks, parseJson, Sql } from "./sql";
import type { IngestMessage } from "./types";

export type ResolvedThread = { threadId: ThreadId; mergedThreadIds: ThreadId[] };

const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

function getOrCreate(q: Sql, accountId: AccountId, key: string, subject: string, date: number): ThreadId {
  const found = q.get<{ id: number }>("SELECT id FROM threads WHERE account_id = ? AND thread_key = ?", accountId, key);
  if (found) return found.id;
  return q.run("INSERT INTO threads (account_id, thread_key, subject, last_date) VALUES (?,?,?,?)", accountId, key, subject, date).lastInsertRowid;
}

function findLinkedThreads(q: Sql, accountId: AccountId, key: string | null, ownId: string | null, linked: string[]): Set<ThreadId> {
  const found = new Set<ThreadId>();
  const keys = [...(key ? [key] : []), ...[...linked, ...(ownId ? [ownId] : [])].map((id) => `mid:${id}`)];
  for (const part of chunks([...new Set(keys)], 200)) {
    for (const r of q.all<{ id: number }>(`SELECT id FROM threads WHERE account_id = ? AND thread_key IN (${Sql.marks(part.length)})`, accountId, ...part)) found.add(r.id);
  }
  for (const part of chunks(linked, 200)) {
    for (const r of q.all<{ thread_id: number }>(`SELECT DISTINCT thread_id FROM messages WHERE account_id = ? AND message_id IN (${Sql.marks(part.length)})`, accountId, ...part)) found.add(r.thread_id);
  }
  if (ownId) {
    for (const r of q.all<{ thread_id: number }>("SELECT DISTINCT thread_id FROM messages WHERE account_id = ? AND in_reply_to = ?", accountId, ownId)) found.add(r.thread_id);
  }
  return found;
}

function findBySubject(q: Sql, accountId: AccountId, msg: IngestMessage, own: ReadonlySet<string>): ThreadId | null {
  if (isGenericSubject(msg.subject) || isAutomatedHeaders(msg.headers)) return null;
  const core = joinSubject(msg.subject);
  if (!core) return null;
  const others = (...lists: Address[][]) => new Set([...participantSet(...lists)].filter((a) => !own.has(a)));
  const mine = others(msg.from, msg.to, msg.cc);
  const rows = q.all<{ thread_id: number; subject: string; from_json: string; to_json: string; cc_json: string; headers_json: string | null }>(
    `SELECT thread_id, subject, from_json, to_json, cc_json, headers_json FROM messages
     WHERE account_id = ? AND draft = 0 AND date BETWEEN ? AND ? AND subject LIKE ? ESCAPE '\\' ORDER BY date DESC LIMIT 200`,
    accountId, msg.date - SUBJECT_JOIN_WINDOW_MS, msg.date + SUBJECT_JOIN_WINDOW_MS, `%${escapeLike(core)}%`,
  );
  for (const r of rows) {
    if (joinSubject(r.subject) !== core) continue;
    if (isAutomatedHeaders(parseJson<Record<string, string>>(r.headers_json, {}))) continue;
    if (sharesParticipant(mine, others(addresses(r.from_json), addresses(r.to_json), addresses(r.cc_json)))) return r.thread_id;
  }
  return null;
}

/** Moves everything from `others` into `primary`, carrying pin, mute and snooze state, then deletes the empty threads. */
export function mergeThreads(q: Sql, primary: ThreadId, others: ThreadId[]): void {
  if (others.length === 0) return;
  const marks = Sql.marks(others.length);
  const state = q.all<{ pinned: number; muted: number; snoozed_until: number | null; resurfaced_at: number | null }>(
    `SELECT pinned, muted, snoozed_until, resurfaced_at FROM threads WHERE id IN (${marks})`, ...others,
  );
  for (const table of ["messages", "drafts", "reminders", "tracked_messages"]) {
    q.run(`UPDATE ${table} SET thread_id = ? WHERE thread_id IN (${marks})`, primary, ...others);
  }
  const max = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.max(a, b));
  const cur = q.get<{ muted: number; snoozed_until: number | null; resurfaced_at: number | null }>("SELECT muted, snoozed_until, resurfaced_at FROM threads WHERE id = ?", primary)!;
  const muted = cur.muted === 1 || state.some((s) => s.muted === 1);
  const snoozed = state.reduce<number | null>((acc, s) => max(acc, s.snoozed_until), cur.snoozed_until);
  const resurfaced = state.reduce<number | null>((acc, s) => max(acc, s.resurfaced_at), cur.resurfaced_at);
  q.run("UPDATE threads SET muted = ?, snoozed_until = ?, resurfaced_at = ? WHERE id = ?", muted, snoozed, resurfaced, primary);
  q.run(`DELETE FROM threads WHERE id IN (${marks})`, ...others);
}

/** SPEC section 4 thread key resolution, including subject fallback and merging of threads a new message links together. */
export function resolveThread(q: Sql, accountId: AccountId, folderId: number, msg: IngestMessage, own: ReadonlySet<string>): ResolvedThread {
  const input = {
    gmThrid: msg.gmThrid ?? null,
    messageId: cleanMessageId(msg.messageId),
    inReplyTo: cleanMessageId(msg.inReplyTo),
    references: msg.references,
  };
  const key = threadKeyFor(input);
  if (input.gmThrid && key) return { threadId: getOrCreate(q, accountId, key, msg.subject, msg.date), mergedThreadIds: [] };

  const found = findLinkedThreads(q, accountId, key, input.messageId, linkedIds(input));
  if (found.size === 0 && !hasParentLink(input)) {
    const bySubject = findBySubject(q, accountId, msg, own);
    if (bySubject !== null) found.add(bySubject);
  }
  if (found.size === 0) {
    return { threadId: getOrCreate(q, accountId, key ?? `local:${folderId}:${msg.uid}`, msg.subject, msg.date), mergedThreadIds: [] };
  }
  const ids = [...found].sort((a, b) => a - b);
  const keyed = key ? q.get<{ id: number }>("SELECT id FROM threads WHERE account_id = ? AND thread_key = ?", accountId, key) : undefined;
  const primary = keyed && found.has(keyed.id) ? keyed.id : ids[0]!;
  const others = ids.filter((id) => id !== primary);
  mergeThreads(q, primary, others);
  return { threadId: primary, mergedThreadIds: others };
}
