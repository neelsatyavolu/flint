import { categorize } from "../categorize";
import type { Category, ThreadId } from "../types";
import { asCategory } from "./mappers";
import { recomputeThreads } from "./rollup";
import { addresses } from "./mappers";
import { chunks, parseJson, Sql } from "./sql";

type Row = { id: number; thread_id: number; subject: string; from_json: string; headers_json: string; category: string | null; draft: number };

/** Who decided a category on purpose. Re-categorizing never overrides these. */
export type CategorySource = "rule" | "manual";

/** Where to re-fetch headers: one IMAP folder and the UIDs of stored mail in it. */
export type HeaderRefreshTarget = { folderId: number; folderPath: string; uids: number[] };

export class RecategorizeRepo {
  constructor(protected q: Sql) {}

  /**
   * Received inbox mail of an account since a date whose category nobody set on purpose, grouped by the folder its
   * UID lives in (All Mail for Gmail). Used to re-fetch headers that older syncs didn't store.
   */
  headerRefreshTargets(accountId: string, sinceMs: number): HeaderRefreshTarget[] {
    const rows = this.q.all<{ folder_id: number; path: string; uid: number }>(
      `SELECT m.folder_id, f.path, m.uid FROM messages m JOIN folders f ON f.id = m.folder_id
       WHERE m.account_id = ? AND m.draft = 0 AND m.category_source IS NULL AND m.date >= ?
         AND EXISTS (SELECT 1 FROM message_folders mf JOIN folders fi ON fi.id = mf.folder_id WHERE mf.message_id = m.id AND fi.role = 'inbox')
       ORDER BY m.folder_id, m.uid`,
      accountId, sinceMs,
    );
    const byFolder = new Map<number, HeaderRefreshTarget>();
    for (const r of rows) {
      const t = byFolder.get(r.folder_id) ?? { folderId: r.folder_id, folderPath: r.path, uids: [] };
      t.uids.push(r.uid);
      byFolder.set(r.folder_id, t);
    }
    return [...byFolder.values()];
  }

  /** Adds freshly fetched headers to stored messages (new values win; nothing is removed). */
  mergeHeaders(folderId: number, items: { uid: number; headers: Record<string, string> }[]): number {
    let n = 0;
    for (const it of items) {
      if (Object.keys(it.headers).length === 0) continue;
      n += Number(this.q.run("UPDATE messages SET headers_json = json_patch(headers_json, ?) WHERE folder_id = ? AND uid = ?", JSON.stringify(it.headers), folderId, it.uid).changes);
    }
    return n;
  }

  /**
   * Re-runs categorize() over stored received mail (headers_json, sender, subject, contact history) and rewrites
   * category where it changed, then recomputes the threads touched. Own sent mail, drafts and mail whose category a
   * rule or the user set (category_source) keep their value.
   * Returns how many messages changed.
   */
  recategorizeAll(): number {
    const own = new Set(this.q.all<{ email: string; aliases: string }>("SELECT email, aliases FROM accounts").flatMap((a) => [a.email.toLowerCase(), ...parseJson<string[]>(a.aliases, []).map((x) => x.toLowerCase())]));
    const known = new Set(this.q.all<{ email: string }>("SELECT email FROM contacts WHERE sent_count > 0").map((c) => c.email));
    const rows = this.q.all<Row>("SELECT id, thread_id, subject, from_json, headers_json, category, draft FROM messages WHERE draft = 0 AND category_source IS NULL");
    const touched = new Set<number>();
    let changed = 0;
    for (const r of rows) {
      const from = addresses(r.from_json)[0] ?? null;
      const address = from?.address.toLowerCase() ?? "";
      if (own.has(address)) continue;
      const next: Category = categorize({
        from, headers: parseJson<Record<string, string>>(r.headers_json, {}), isKnownContact: known.has(address), subject: r.subject,
      });
      if (next === (asCategory(r.category) ?? "people") && r.category !== null) continue;
      this.q.run("UPDATE messages SET category = ? WHERE id = ?", next, r.id);
      touched.add(r.thread_id);
      changed += 1;
    }
    recomputeThreads(this.q, touched);
    return changed;
  }

  /**
   * Sets the category of every received message in these threads and records who decided it, so a later
   * recategorizeAll() keeps it. Used by the rule "category" action and by manual changes.
   */
  pinCategory(threadIds: ThreadId[], category: Category, source: CategorySource): void {
    for (const part of chunks(threadIds)) {
      this.q.run(
        `UPDATE messages SET category = ?, category_source = ? WHERE draft = 0 AND thread_id IN (${Sql.marks(part.length)})`,
        category, source, ...part,
      );
    }
    recomputeThreads(this.q, threadIds);
  }
}
