import { rollupCategory } from "../categorize";
import type { Category, MessageRowId, ThreadId } from "../types";
import { asCategory } from "./mappers";
import { chunks, Sql } from "./sql";

/** Recomputes subject, last_date, category and pinned from a thread's messages. Deletes the thread when it has none. Returns false when deleted. */
export function recomputeThread(q: Sql, threadId: ThreadId): boolean {
  const all = q.all<{ subject: string; date: number; category: string | null; flagged: number; draft: number }>(
    "SELECT subject, date, category, flagged, draft FROM messages WHERE thread_id = ? ORDER BY date, id", threadId,
  );
  // Server drafts do not count toward the conversation's date, subject or category unless they are all there is.
  const rows = all.some((r) => r.draft === 0) ? all.filter((r) => r.draft === 0) : all;
  if (all.length === 0) {
    q.run("DELETE FROM threads WHERE id = ?", threadId);
    return false;
  }
  const category: Category = rollupCategory(rows.map((r) => ({ category: asCategory(r.category), date: r.date })));
  const lastDate = rows.reduce((m, r) => Math.max(m, r.date), 0);
  const pinned = rows.some((r) => r.flagged === 1);
  q.run("UPDATE threads SET subject = ?, last_date = ?, category = ?, pinned = ? WHERE id = ?", rows[0]!.subject, lastDate, category, pinned, threadId);
  return true;
}

export function recomputeThreads(q: Sql, ids: Iterable<ThreadId>): void {
  for (const id of new Set(ids)) recomputeThread(q, id);
}

/** Deletes messages (and their search rows), then recomputes the threads they were in. Returns those thread ids. */
export function deleteMessages(q: Sql, ids: readonly MessageRowId[]): ThreadId[] {
  if (ids.length === 0) return [];
  const threads = new Set<ThreadId>();
  for (const part of chunks(ids)) {
    const marks = Sql.marks(part.length);
    for (const r of q.all<{ thread_id: number }>(`SELECT DISTINCT thread_id FROM messages WHERE id IN (${marks})`, ...part)) threads.add(r.thread_id);
    q.run(`DELETE FROM messages_fts WHERE rowid IN (${marks})`, ...part);
    q.run(`DELETE FROM messages WHERE id IN (${marks})`, ...part);
  }
  recomputeThreads(q, threads);
  return [...threads];
}
