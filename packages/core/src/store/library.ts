import { z } from "zod";
import { FlintError, type Signature, type Template, type ThreadId } from "../types";
import type { AccountsRepo } from "./accounts";
import { addresses, lowerAddr } from "./mappers";
import { bool, type Sql } from "./sql";
import type { Reminder, ReminderStatus } from "./types";

const signatureSchema = z.object({
  id: z.number().int().optional(), name: z.string().min(1).max(120), html: z.string().max(200_000),
  accountId: z.string().nullable(), defaultNew: z.boolean(), defaultReply: z.boolean(),
});
const templateSchema = z.object({ id: z.number().int().optional(), name: z.string().min(1).max(120), subject: z.string().max(500), html: z.string().max(200_000) });

type SigRow = { id: number; name: string; html: string; account_id: string | null; default_new: number; default_reply: number };
const toSig = (r: SigRow): Signature => ({ id: r.id, name: r.name, html: r.html, accountId: r.account_id, defaultNew: bool(r.default_new), defaultReply: bool(r.default_reply) });

export class LibraryRepo {
  constructor(protected q: Sql) {}

  listSignatures(): Signature[] {
    return this.q.all<SigRow>("SELECT * FROM signatures ORDER BY name COLLATE NOCASE, id").map(toSig);
  }

  getSignature(id: number): Signature | null {
    const r = this.q.get<SigRow>("SELECT * FROM signatures WHERE id = ?", id);
    return r ? toSig(r) : null;
  }

  /** Insert or update. Only one signature per account scope can be the default for new mail or for replies. */
  saveSignature(input: Omit<Signature, "id"> & { id?: number }, now: number = Date.now()): Signature {
    const p = signatureSchema.safeParse(input);
    if (!p.success) throw new FlintError("invalid", "That signature is not valid.");
    const s = p.data;
    let id = s.id;
    if (id !== undefined) {
      if (!this.getSignature(id)) throw new FlintError("not_found", "That signature no longer exists.");
      this.q.run("UPDATE signatures SET name=?, html=?, account_id=?, default_new=?, default_reply=?, updated_at=? WHERE id=?", s.name, s.html, s.accountId, s.defaultNew, s.defaultReply, now, id);
    } else {
      id = this.q.run("INSERT INTO signatures (name, html, account_id, default_new, default_reply, updated_at) VALUES (?,?,?,?,?,?)", s.name, s.html, s.accountId, s.defaultNew, s.defaultReply, now).lastInsertRowid;
    }
    if (s.defaultNew) this.q.run("UPDATE signatures SET default_new = 0 WHERE id <> ? AND account_id IS ?", id, s.accountId);
    if (s.defaultReply) this.q.run("UPDATE signatures SET default_reply = 0 WHERE id <> ? AND account_id IS ?", id, s.accountId);
    return this.getSignature(id)!;
  }

  deleteSignature(id: number): void {
    this.q.run("DELETE FROM signatures WHERE id = ?", id);
  }

  listTemplates(): Template[] {
    return this.q.all<Template>("SELECT id, name, subject, html FROM templates ORDER BY name COLLATE NOCASE, id");
  }

  getTemplate(id: number): Template | null {
    return this.q.get<Template>("SELECT id, name, subject, html FROM templates WHERE id = ?", id) ?? null;
  }

  saveTemplate(input: Omit<Template, "id"> & { id?: number }, now: number = Date.now()): Template {
    const p = templateSchema.safeParse(input);
    if (!p.success) throw new FlintError("invalid", "That template is not valid.");
    const t = p.data;
    if (t.id !== undefined) {
      if (!this.getTemplate(t.id)) throw new FlintError("not_found", "That template no longer exists.");
      this.q.run("UPDATE templates SET name=?, subject=?, html=?, updated_at=? WHERE id=?", t.name, t.subject, t.html, now, t.id);
      return this.getTemplate(t.id)!;
    }
    const id = this.q.run("INSERT INTO templates (name, subject, html, updated_at) VALUES (?,?,?,?)", t.name, t.subject, t.html, now).lastInsertRowid;
    return this.getTemplate(id)!;
  }

  deleteTemplate(id: number): void {
    this.q.run("DELETE FROM templates WHERE id = ?", id);
  }
}

type ReminderRow = { id: number; account_id: string; thread_id: number | null; message_id: string; remind_at: number; status: string };
const toReminder = (r: ReminderRow): Reminder => ({ id: r.id, accountId: r.account_id, threadId: r.thread_id, messageId: r.message_id, remindAt: r.remind_at, status: r.status as ReminderStatus });

export class RemindersRepo {
  constructor(protected q: Sql, private accounts: AccountsRepo) {}

  createReminder(input: { accountId: string; threadId: ThreadId | null; messageId: string; remindAt: number }): Reminder {
    const id = this.q.run("INSERT INTO reminders (account_id, thread_id, message_id, remind_at) VALUES (?,?,?,?)",
      input.accountId, input.threadId, input.messageId.replace(/^<+|>+$/g, ""), input.remindAt).lastInsertRowid;
    return this.getReminder(id)!;
  }

  getReminder(id: number): Reminder | null {
    const r = this.q.get<ReminderRow>("SELECT * FROM reminders WHERE id = ?", id);
    return r ? toReminder(r) : null;
  }

  listDueReminders(now: number): Reminder[] {
    return this.q.all<ReminderRow>("SELECT * FROM reminders WHERE status = 'pending' AND remind_at <= ? ORDER BY remind_at, id", now).map(toReminder);
  }

  nextReminderAt(): number | null {
    return this.q.get<{ t: number | null }>("SELECT MIN(remind_at) AS t FROM reminders WHERE status = 'pending'")?.t ?? null;
  }

  listPendingReminders(limit = 50): Reminder[] {
    return this.q.all<ReminderRow>("SELECT * FROM reminders WHERE status = 'pending' ORDER BY remind_at, id LIMIT ?", limit).map(toReminder);
  }

  setReminderStatus(id: number, status: ReminderStatus): void {
    this.q.run("UPDATE reminders SET status = ? WHERE id = ?", status, id);
  }

  cancelRemindersForMessage(accountId: string, messageId: string): void {
    this.q.run("UPDATE reminders SET status = 'cancelled' WHERE account_id = ? AND message_id = ? AND status = 'pending'", accountId, messageId.replace(/^<+|>+$/g, ""));
  }

  /** True when someone other than the user wrote in the thread after `since`. Used to decide fired vs replied. */
  threadHasReplySince(threadId: ThreadId, since: number): boolean {
    const own = this.accounts.ownAddresses();
    const rows = this.q.all<{ from_json: string }>("SELECT from_json FROM messages WHERE thread_id = ? AND date > ? AND draft = 0", threadId, since);
    return rows.some((r) => addresses(r.from_json).some((a) => !own.has(lowerAddr(a))));
  }
}
