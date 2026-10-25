import { FlintError, type ComposeMode, type Draft, type DraftAttachment, type DraftPatch, type ScheduledSend, type ThreadId } from "../types";
import { addresses } from "./mappers";
import { bool, parseJson, type Sql } from "./sql";

export type NewDraft = Pick<Draft, "accountId" | "from"> & Partial<Omit<Draft, "id" | "updatedAt" | "accountId" | "from">> & {
  inReplyTo?: string | null;
  references?: string[];
};
export type DraftUpdate = DraftPatch & Partial<Pick<Draft, "attachments" | "quotedHtml" | "threadId" | "sourceMessageId" | "mode" | "createdBy">>;
export type DraftMeta = { inReplyTo: string | null; references: string[]; serverUid: number | null };

type DraftRow = {
  id: number; account_id: string; from_address: string; mode: string; source_message_id: number | null; thread_id: number | null;
  to_json: string; cc_json: string; bcc_json: string; subject: string; html: string; quoted_html: string; attachments_json: string;
  signature_id: number | null; track: number; remind_at: number | null; in_reply_to: string | null; refs: string; server_uid: number | null;
  created_by: string; updated_at: number;
};

const toDraft = (r: DraftRow): Draft => ({
  id: r.id, accountId: r.account_id, from: r.from_address, mode: r.mode as ComposeMode, sourceMessageId: r.source_message_id, threadId: r.thread_id,
  to: addresses(r.to_json), cc: addresses(r.cc_json), bcc: addresses(r.bcc_json), subject: r.subject, html: r.html, quotedHtml: r.quoted_html,
  attachments: parseJson<DraftAttachment[]>(r.attachments_json, []), signatureId: r.signature_id, track: bool(r.track), remindAt: r.remind_at,
  createdBy: r.created_by, updatedAt: r.updated_at,
});

const COLUMNS: Record<string, string> = {
  from: "from_address", accountId: "account_id", mode: "mode", sourceMessageId: "source_message_id", threadId: "thread_id",
  to: "to_json", cc: "cc_json", bcc: "bcc_json", subject: "subject", html: "html", quotedHtml: "quoted_html",
  attachments: "attachments_json", signatureId: "signature_id", track: "track", remindAt: "remind_at", createdBy: "created_by",
};
const JSON_FIELDS = new Set(["to", "cc", "bcc", "attachments"]);

export class DraftsRepo {
  constructor(protected q: Sql) {}

  createDraft(input: NewDraft, now: number = Date.now()): Draft {
    const id = this.q.run(
      `INSERT INTO drafts (account_id, from_address, mode, source_message_id, thread_id, to_json, cc_json, bcc_json, subject, html, quoted_html,
         attachments_json, signature_id, track, remind_at, in_reply_to, refs, created_by, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      input.accountId, input.from, input.mode ?? "new", input.sourceMessageId ?? null, input.threadId ?? null,
      JSON.stringify(input.to ?? []), JSON.stringify(input.cc ?? []), JSON.stringify(input.bcc ?? []), input.subject ?? "", input.html ?? "",
      input.quotedHtml ?? "", JSON.stringify(input.attachments ?? []), input.signatureId ?? null, input.track ?? true, input.remindAt ?? null,
      input.inReplyTo ?? null, JSON.stringify(input.references ?? []), input.createdBy ?? "user", now,
    ).lastInsertRowid;
    return this.requireDraft(id);
  }

  getDraft(id: number): Draft | null {
    const r = this.q.get<DraftRow>("SELECT * FROM drafts WHERE id = ?", id);
    return r ? toDraft(r) : null;
  }

  requireDraft(id: number): Draft {
    const d = this.getDraft(id);
    if (!d) throw new FlintError("not_found", "That draft no longer exists.");
    return d;
  }

  updateDraft(id: number, patch: DraftUpdate, now: number = Date.now()): Draft {
    this.requireDraft(id);
    const sets: string[] = [];
    const params: (string | number | boolean | null)[] = [];
    for (const [key, value] of Object.entries(patch)) {
      const column = COLUMNS[key];
      if (!column || value === undefined) continue;
      sets.push(`${column} = ?`);
      params.push(JSON_FIELDS.has(key) ? JSON.stringify(value) : (value as string | number | boolean | null));
    }
    sets.push("updated_at = ?");
    this.q.run(`UPDATE drafts SET ${sets.join(", ")} WHERE id = ?`, ...params, now, id);
    return this.requireDraft(id);
  }

  deleteDraft(id: number): void {
    this.q.run("DELETE FROM drafts WHERE id = ?", id);
  }

  /** Newest edit first. */
  listDrafts(): Draft[] {
    return this.q.all<DraftRow>("SELECT * FROM drafts ORDER BY updated_at DESC, id DESC").map(toDraft);
  }

  listDraftsForThread(threadId: ThreadId): Draft[] {
    return this.q.all<DraftRow>("SELECT * FROM drafts WHERE thread_id = ? ORDER BY id", threadId).map(toDraft);
  }

  /** Reply headers and the server Drafts copy, which the Draft type does not carry. */
  getDraftMeta(id: number): DraftMeta {
    const r = this.q.get<{ in_reply_to: string | null; refs: string; server_uid: number | null }>("SELECT in_reply_to, refs, server_uid FROM drafts WHERE id = ?", id);
    if (!r) throw new FlintError("not_found", "That draft no longer exists.");
    return { inReplyTo: r.in_reply_to, references: parseJson<string[]>(r.refs, []), serverUid: r.server_uid };
  }

  setDraftMeta(id: number, patch: Partial<DraftMeta>): void {
    const cur = this.getDraftMeta(id);
    const next = { ...cur, ...patch };
    this.q.run("UPDATE drafts SET in_reply_to = ?, refs = ?, server_uid = ? WHERE id = ?", next.inReplyTo, JSON.stringify(next.references), next.serverUid, id);
  }
}

// ---- scheduled sends

export type ScheduledSendRow = ScheduledSend & { attempts: number; messageId: string | null; createdAt: number };
type ScheduledRow = { id: number; draft_id: number; send_at: number; status: string; attempts: number; error: string | null; message_id: string | null; requested_by: string; created_at: number; subject: string | null; to_json: string | null };

const SCHEDULED_SELECT = `SELECT s.*, d.subject AS subject, d.to_json AS to_json FROM scheduled_sends s LEFT JOIN drafts d ON d.id = s.draft_id`;
const toScheduled = (r: ScheduledRow): ScheduledSendRow => ({
  id: r.id, draftId: r.draft_id, subject: r.subject ?? "", to: addresses(r.to_json), sendAt: r.send_at, status: r.status as ScheduledSend["status"],
  error: r.error, requestedBy: r.requested_by, attempts: r.attempts, messageId: r.message_id, createdAt: r.created_at,
});

export class ScheduledRepo {
  constructor(protected q: Sql) {}

  createScheduledSend(input: { draftId: number; sendAt: number; status?: ScheduledSend["status"]; requestedBy?: string }, now: number = Date.now()): ScheduledSendRow {
    const id = this.q.run("INSERT INTO scheduled_sends (draft_id, send_at, status, requested_by, created_at) VALUES (?,?,?,?,?)",
      input.draftId, input.sendAt, input.status ?? "pending", input.requestedBy ?? "user", now).lastInsertRowid;
    return this.requireScheduled(id);
  }

  getScheduledSend(id: number): ScheduledSendRow | null {
    const r = this.q.get<ScheduledRow>(`${SCHEDULED_SELECT} WHERE s.id = ?`, id);
    return r ? toScheduled(r) : null;
  }

  requireScheduled(id: number): ScheduledSendRow {
    const s = this.getScheduledSend(id);
    if (!s) throw new FlintError("not_found", "That scheduled send no longer exists.");
    return s;
  }

  /** Pending sends whose time has come, oldest first. */
  listDueScheduled(now: number): ScheduledSendRow[] {
    return this.q.all<ScheduledRow>(`${SCHEDULED_SELECT} WHERE s.status = 'pending' AND s.send_at <= ? ORDER BY s.send_at, s.id`, now).map(toScheduled);
  }

  /** Earliest send_at among pending sends, for arming the timer. */
  nextScheduledAt(): number | null {
    return this.q.get<{ t: number | null }>("SELECT MIN(send_at) AS t FROM scheduled_sends WHERE status = 'pending'")?.t ?? null;
  }

  /** What the UI shows: queued, awaiting approval, sending and failed sends. */
  listScheduled(): ScheduledSendRow[] {
    return this.q.all<ScheduledRow>(`${SCHEDULED_SELECT} WHERE s.status IN ('pending','awaiting_approval','sending','failed') ORDER BY s.send_at, s.id`).map(toScheduled);
  }

  findOpenScheduledForDraft(draftId: number): ScheduledSendRow | null {
    const r = this.q.get<ScheduledRow>(`${SCHEDULED_SELECT} WHERE s.draft_id = ? AND s.status IN ('pending','awaiting_approval','sending') ORDER BY s.id DESC LIMIT 1`, draftId);
    return r ? toScheduled(r) : null;
  }

  updateScheduled(id: number, patch: { status?: ScheduledSend["status"]; error?: string | null; attempts?: number; messageId?: string | null; sendAt?: number }): ScheduledSendRow {
    const cur = this.requireScheduled(id);
    this.q.run("UPDATE scheduled_sends SET status = ?, error = ?, attempts = ?, message_id = ?, send_at = ? WHERE id = ?",
      patch.status ?? cur.status, patch.error === undefined ? cur.error : patch.error, patch.attempts ?? cur.attempts,
      patch.messageId === undefined ? cur.messageId : patch.messageId, patch.sendAt ?? cur.sendAt, id);
    return this.requireScheduled(id);
  }
}
