import { tx } from "../db/open";
import { FlintError, type FolderId, type MailboxRole, type MessageRowId, type ThreadId } from "../types";
import type { AccountsRepo } from "./accounts";
import type { FoldersRepo } from "./folders";
import type { MessagesRepo } from "./messages";
import { recomputeThreads } from "./rollup";
import { bool, chunks, Sql } from "./sql";
import type { ActionResult, MoveTarget, ThreadSnapshot } from "./types";

type MsgState = { id: number; thread_id: number; account_id: string; seen: number; flagged: number; draft: number; folder_id: number; uid: number; answered: number; category: string | null; category_source: string | null };

/** Local (optimistic) thread state changes. Each returns an undo snapshot and the locations of messages the mail engine must update on the server. */
export class ThreadActionsRepo {
  constructor(protected q: Sql, private accounts: AccountsRepo, private folders: FoldersRepo, private messages: MessagesRepo) {}

  /** Serializable copy of the thread state, message flags and folder membership. Pass to restoreSnapshot to undo. */
  snapshotThreads(threadIds: ThreadId[]): ThreadSnapshot {
    const threads: ThreadSnapshot["threads"] = [];
    for (const part of chunks(threadIds)) {
      const marks = Sql.marks(part.length);
      const rows = this.q.all<{ id: number; pinned: number; muted: number; snoozed_until: number | null; resurfaced_at: number | null }>(`SELECT id, pinned, muted, snoozed_until, resurfaced_at FROM threads WHERE id IN (${marks})`, ...part);
      const msgs = this.q.all<MsgState>(`SELECT id, thread_id, account_id, seen, flagged, answered, draft, folder_id, uid, category, category_source FROM messages WHERE thread_id IN (${marks}) ORDER BY id`, ...part);
      const members = this.#members(msgs.map((m) => m.id));
      for (const t of rows) {
        threads.push({
          id: t.id, pinned: bool(t.pinned), muted: bool(t.muted), snoozedUntil: t.snoozed_until, resurfacedAt: t.resurfaced_at,
          messages: msgs.filter((m) => m.thread_id === t.id).map((m) => ({
            id: m.id, folderId: m.folder_id, uid: m.uid, seen: bool(m.seen), flagged: bool(m.flagged), answered: bool(m.answered),
            memberFolderIds: members.get(m.id) ?? [], category: m.category, categorySource: m.category_source,
          })),
        });
      }
    }
    return { version: 1, threads };
  }

  /**
   * Puts thread state, flags and folder membership back. Server UIDs are not touched: if the engine already moved
   * mail on the server it runs the inverse operation using the snapshot's folderId/uid. Returns restored thread ids.
   */
  restoreSnapshot(snapshot: ThreadSnapshot): ThreadId[] {
    return tx(this.q.db, () => {
      const restored: ThreadId[] = [];
      for (const t of snapshot.threads) {
        if (!this.q.get("SELECT 1 FROM threads WHERE id = ?", t.id)) continue;
        this.q.run("UPDATE threads SET pinned = ?, muted = ?, snoozed_until = ?, resurfaced_at = ? WHERE id = ?", t.pinned, t.muted, t.snoozedUntil, t.resurfacedAt, t.id);
        for (const m of t.messages) {
          if (!this.q.get("SELECT 1 FROM messages WHERE id = ?", m.id)) continue;
          this.q.run("UPDATE messages SET seen = ?, flagged = ?, answered = ? WHERE id = ?", m.seen, m.flagged, m.answered, m.id);
          if (m.category !== undefined) this.q.run("UPDATE messages SET category = ?, category_source = ? WHERE id = ?", m.category, m.categorySource ?? null, m.id);
          this.q.run("DELETE FROM message_folders WHERE message_id = ?", m.id);
          for (const f of m.memberFolderIds) this.q.run("INSERT OR IGNORE INTO message_folders (message_id, folder_id) SELECT ?, id FROM folders WHERE id = ?", m.id, f);
        }
        restored.push(t.id);
      }
      recomputeThreads(this.q, restored);
      return restored;
    });
  }

  markRead(threadIds: ThreadId[], read: boolean): ActionResult {
    return this.#apply(threadIds, (msgs) => {
      const changed = msgs.filter((m) => m.draft === 0 && bool(m.seen) !== read).map((m) => m.id);
      this.#setColumn("seen", read, changed);
      return changed;
    });
  }

  /** Pins or unpins the thread and flags (or unflags) its messages, mirroring \Flagged on the server. */
  setPinned(threadIds: ThreadId[], pinned: boolean): ActionResult {
    return this.#apply(threadIds, (msgs) => {
      const changed = msgs.filter((m) => m.draft === 0 && bool(m.flagged) !== pinned).map((m) => m.id);
      this.#setColumn("flagged", pinned, changed);
      for (const part of chunks(threadIds)) this.q.run(`UPDATE threads SET pinned = ? WHERE id IN (${Sql.marks(part.length)})`, pinned, ...part);
      return changed;
    });
  }

  setMuted(threadIds: ThreadId[], muted: boolean): ActionResult {
    return this.#apply(threadIds, () => {
      for (const part of chunks(threadIds)) this.q.run(`UPDATE threads SET muted = ? WHERE id IN (${Sql.marks(part.length)})`, muted, ...part);
      return [];
    });
  }

  snooze(threadIds: ThreadId[], until: number): ActionResult {
    return this.#apply(threadIds, () => {
      for (const part of chunks(threadIds)) this.q.run(`UPDATE threads SET snoozed_until = ?, resurfaced_at = NULL WHERE id IN (${Sql.marks(part.length)})`, until, ...part);
      return [];
    });
  }

  unsnooze(threadIds: ThreadId[]): ActionResult {
    return this.#apply(threadIds, () => {
      for (const part of chunks(threadIds)) this.q.run(`UPDATE threads SET snoozed_until = NULL WHERE id IN (${Sql.marks(part.length)})`, ...part);
      return [];
    });
  }

  /** Threads whose snooze has expired. */
  listDueSnoozes(now: number): ThreadId[] {
    return this.q.all<{ id: number }>("SELECT id FROM threads WHERE snoozed_until IS NOT NULL AND snoozed_until <= ? ORDER BY snoozed_until", now).map((r) => r.id);
  }

  /** Snooze fired: clears it, sets resurfaced_at, and marks the latest message unread (returned in locations). */
  wakeSnoozed(threadId: ThreadId, now: number): ActionResult {
    return this.#apply([threadId], (msgs) => {
      this.q.run("UPDATE threads SET snoozed_until = NULL, resurfaced_at = ? WHERE id = ?", now, threadId);
      const latest = [...msgs].filter((m) => m.draft === 0).sort((a, b) => b.id - a.id)[0];
      if (!latest || latest.seen === 0) return [];
      this.#setColumn("seen", false, [latest.id]);
      return [latest.id];
    });
  }

  /** Reminder fired: sorts the thread to the top again without changing flags. */
  resurface(threadId: ThreadId, now: number): void {
    this.q.run("UPDATE threads SET resurfaced_at = ? WHERE id = ?", now, threadId);
  }

  /**
   * Optimistic archive, trash, spam, move to inbox or move to folder, expressed as folder membership.
   * Gmail archive removes the INBOX label; generic IMAP archive means membership of the Archive folder.
   * Sent and draft messages stay where they are for archive, inbox and folder moves.
   */
  moveThreads(threadIds: ThreadId[], target: MoveTarget): ActionResult {
    return this.#apply(threadIds, (msgs) => {
      const members = this.#members(msgs.map((m) => m.id));
      const folderCache = new Map<string, number | null>();
      const lookup = (accountId: string, role: MailboxRole, create = false): number | null => {
        const key = `${accountId}:${role}`;
        if (!folderCache.has(key)) {
          const f = create ? this.folders.ensureFolderByRole(accountId, role) : this.folders.getFolderByRole(accountId, role);
          folderCache.set(key, f?.id ?? null);
        }
        return folderCache.get(key) ?? null;
      };
      const need = (accountId: string, role: MailboxRole): number => {
        const id = lookup(accountId, role);
        if (id === null) throw new FlintError("not_found", `This account has no ${role} folder yet.`);
        return id;
      };
      const roles = this.#roleMap();
      const providers = new Map(this.accounts.listAccounts().map((a) => [a.id, a.provider]));
      const targetFolder = target.kind === "folder" ? this.folders.requireFolder(target.folderId) : null;
      const changed: MessageRowId[] = [];
      for (const m of msgs) {
        const cur = members.get(m.id) ?? [];
        const curRoles = new Set(cur.map((f) => roles.get(f)).filter((r): r is MailboxRole => !!r));
        const gmail = providers.get(m.account_id) === "gmail";
        const keep = curRoles.has("sent") || curRoles.has("drafts") || m.draft === 1;
        let next: number[] | null = null;
        const drop = (...rs: MailboxRole[]) => cur.filter((f) => !rs.includes(roles.get(f) as MailboxRole));
        const withAll = (ids: number[]) => { const all = lookup(m.account_id, "all"); return all !== null && gmail ? [...ids, all] : ids; };
        switch (target.kind) {
          case "trash": next = m.draft === 1 ? null : [need(m.account_id, "trash")]; break;
          case "spam": next = m.draft === 1 ? null : [need(m.account_id, "spam")]; break;
          case "archive":
            if (!keep || curRoles.has("inbox")) next = gmail ? withAll(drop("inbox", "trash", "spam")) : [lookup(m.account_id, "archive", true)!];
            break;
          case "inbox":
            if (!keep) next = gmail ? withAll([...drop("trash", "spam"), need(m.account_id, "inbox")]) : [need(m.account_id, "inbox")];
            break;
          case "folder":
            if (!keep && targetFolder && targetFolder.accountId === m.account_id) next = gmail ? withAll([...drop("inbox", "trash", "spam"), targetFolder.id]) : [targetFolder.id];
            break;
        }
        if (!next) continue;
        const unique = [...new Set(next)];
        if (unique.length === cur.length && unique.every((f) => cur.includes(f))) continue;
        this.q.run("DELETE FROM message_folders WHERE message_id = ?", m.id);
        for (const f of unique) this.q.run("INSERT OR IGNORE INTO message_folders (message_id, folder_id) VALUES (?,?)", m.id, f);
        changed.push(m.id);
      }
      return changed;
    });
  }

  /** After the engine moved a message on the server: record its new folder and UID so a later sync does not duplicate it. */
  relocateMessage(messageRowId: MessageRowId, folderId: FolderId, uid: number): void {
    tx(this.q.db, () => {
      const clash = this.q.get<{ id: number }>("SELECT id FROM messages WHERE folder_id = ? AND uid = ? AND id <> ?", folderId, uid, messageRowId);
      if (clash) {
        this.q.run("DELETE FROM messages_fts WHERE rowid = ?", clash.id);
        this.q.run("DELETE FROM messages WHERE id = ?", clash.id);
      }
      this.q.run("UPDATE messages SET folder_id = ?, uid = ? WHERE id = ?", folderId, uid, messageRowId);
      this.q.run("INSERT OR IGNORE INTO message_folders (message_id, folder_id) VALUES (?,?)", messageRowId, folderId);
    });
  }

  // ---- internals

  #apply(threadIds: ThreadId[], change: (msgs: MsgState[]) => MessageRowId[]): ActionResult {
    return tx(this.q.db, () => {
      const ids = [...new Set(threadIds)];
      const snapshot = this.snapshotThreads(ids);
      const msgs: MsgState[] = [];
      for (const part of chunks(ids)) {
        msgs.push(...this.q.all<MsgState>(`SELECT id, thread_id, account_id, seen, flagged, answered, draft, folder_id, uid, category, category_source FROM messages WHERE thread_id IN (${Sql.marks(part.length)}) ORDER BY date, id`, ...part));
      }
      const changed = change(msgs);
      recomputeThreads(this.q, ids);
      return { snapshot, locations: this.messages.getMessageLocations(changed) };
    });
  }

  #setColumn(column: "seen" | "flagged", value: boolean, ids: number[]): void {
    for (const part of chunks(ids)) this.q.run(`UPDATE messages SET ${column} = ? WHERE id IN (${Sql.marks(part.length)})`, value, ...part);
  }

  #members(messageIds: number[]): Map<number, number[]> {
    const out = new Map<number, number[]>();
    for (const part of chunks(messageIds)) {
      for (const r of this.q.all<{ message_id: number; folder_id: number }>(`SELECT message_id, folder_id FROM message_folders WHERE message_id IN (${Sql.marks(part.length)}) ORDER BY folder_id`, ...part)) {
        out.set(r.message_id, [...(out.get(r.message_id) ?? []), r.folder_id]);
      }
    }
    return out;
  }

  #roleMap(): Map<number, MailboxRole | null> {
    return new Map(this.q.all<{ id: number; role: string | null }>("SELECT id, role FROM folders").map((f) => [f.id, f.role as MailboxRole | null]));
  }
}
