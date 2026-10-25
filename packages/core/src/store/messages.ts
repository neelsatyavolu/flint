import type { AccountId, AttachmentInfo, FolderId, MailboxRole, MessageRowId, Provider, ThreadId } from "../types";
import { addresses, asCategory } from "./mappers";
import { parseJson, Sql, bool, chunks } from "./sql";
import type { MessageLocation, StoredMessage, StoredThreadMessage, ThreadRows } from "./types";
import { parseUnsubscribe } from "./unsubscribe";
import type { AccountsRepo } from "./accounts";
import { lowerAddr } from "./mappers";

type MessageRow = {
  id: number; account_id: string; thread_id: number; folder_id: number; uid: number; gm_msgid: string | null; gm_thrid: string | null;
  message_id: string | null; in_reply_to: string | null; refs: string; subject: string; from_json: string; to_json: string; cc_json: string;
  bcc_json: string; reply_to_json: string; date: number; snippet: string; seen: number; flagged: number; answered: number; draft: number;
  has_attachments: number; size: number; headers_json: string; body_state: string; text_body: string | null; html_body: string | null; category: string | null;
};

export function rowToStored(r: MessageRow): StoredMessage {
  return {
    id: r.id, accountId: r.account_id, threadId: r.thread_id, folderId: r.folder_id, uid: r.uid, gmMsgid: r.gm_msgid, gmThrid: r.gm_thrid,
    messageId: r.message_id, inReplyTo: r.in_reply_to, references: parseJson<string[]>(r.refs, []), subject: r.subject,
    from: addresses(r.from_json), to: addresses(r.to_json), cc: addresses(r.cc_json), bcc: addresses(r.bcc_json), replyTo: addresses(r.reply_to_json),
    date: r.date, snippet: r.snippet, seen: bool(r.seen), flagged: bool(r.flagged), answered: bool(r.answered), draft: bool(r.draft),
    hasAttachments: bool(r.has_attachments), size: r.size, headers: parseJson<Record<string, string>>(r.headers_json, {}),
    bodyLoaded: r.body_state === "full", text: r.text_body, rawHtml: r.html_body, category: asCategory(r.category),
  };
}

type AttachmentRow = { id: number; message_id: number; part: string; filename: string; content_type: string; size: number; content_id: string | null; inline: number; cached_path: string | null };

export class MessagesRepo {
  constructor(protected q: Sql, private accounts: AccountsRepo) {}

  getMessage(id: MessageRowId): StoredMessage | null {
    const r = this.q.get<MessageRow>("SELECT * FROM messages WHERE id = ?", id);
    return r ? rowToStored(r) : null;
  }

  /** Every row with this Message-ID header in the account (a message can live in several folders). */
  findByMessageId(accountId: AccountId, messageId: string): StoredMessage[] {
    const id = messageId.trim().replace(/^<+|>+$/g, "");
    return this.q.all<MessageRow>("SELECT * FROM messages WHERE account_id = ? AND message_id = ? ORDER BY id", accountId, id).map(rowToStored);
  }

  findByFolderUid(folderId: FolderId, uid: number): StoredMessage | null {
    const r = this.q.get<MessageRow>("SELECT * FROM messages WHERE folder_id = ? AND uid = ?", folderId, uid);
    return r ? rowToStored(r) : null;
  }

  getAttachment(id: number): (AttachmentInfo & { messageRowId: MessageRowId; part: string; cachedPath: string | null }) | null {
    const r = this.q.get<AttachmentRow>("SELECT * FROM attachments WHERE id = ?", id);
    return r ? { ...this.#toInfo(r), messageRowId: r.message_id, part: r.part, cachedPath: r.cached_path } : null;
  }

  setAttachmentCachedPath(id: number, path: string | null): void {
    this.q.run("UPDATE attachments SET cached_path = ? WHERE id = ?", path, id);
  }

  /** Folder/uid locations (with current label membership) of the given messages. */
  getMessageLocations(ids: MessageRowId[]): MessageLocation[] {
    return this.#locations("m.id", ids);
  }

  /** Folder/uid locations of every message in the given threads: what the mail engine needs to run IMAP actions. */
  getThreadLocations(threadIds: ThreadId[]): MessageLocation[] {
    return this.#locations("m.thread_id", threadIds);
  }

  /** Thread plus its messages, oldest first, with attachments and parsed unsubscribe info. HTML is raw: the caller sanitizes. */
  getThreadRows(threadId: ThreadId): ThreadRows | null {
    const t = this.q.get<{ id: number; account_id: string; subject: string; category: string; pinned: number; muted: number; snoozed_until: number | null; resurfaced_at: number | null }>(
      "SELECT * FROM threads WHERE id = ?", threadId,
    );
    if (!t) return null;
    const own = this.accounts.ownAddresses();
    const rows = this.q.all<MessageRow>("SELECT * FROM messages WHERE thread_id = ? ORDER BY date, id", threadId);
    const atts = this.q.all<AttachmentRow>("SELECT a.* FROM attachments a JOIN messages m ON m.id = a.message_id WHERE m.thread_id = ? ORDER BY a.id", threadId);
    const byMsg = new Map<number, AttachmentInfo[]>();
    for (const a of atts) byMsg.set(a.message_id, [...(byMsg.get(a.message_id) ?? []), this.#toInfo(a)]);
    const messages: StoredThreadMessage[] = rows.map((r) => {
      const m = rowToStored(r);
      return { ...m, isFromMe: m.from.some((a) => own.has(lowerAddr(a))), attachments: byMsg.get(m.id) ?? [], unsubscribe: parseUnsubscribe(m.headers) };
    });
    const draftIds = this.q.all<{ id: number }>("SELECT id FROM drafts WHERE thread_id = ? ORDER BY id", threadId).map((d) => d.id);
    return {
      id: t.id, accountId: t.account_id, subject: t.subject, category: asCategory(t.category) ?? "people",
      pinned: bool(t.pinned), muted: bool(t.muted), snoozedUntil: t.snoozed_until, resurfacedAt: t.resurfaced_at, messages, draftIds,
    };
  }

  #toInfo(a: AttachmentRow): AttachmentInfo {
    return { id: a.id, filename: a.filename, contentType: a.content_type, size: a.size, inline: bool(a.inline), contentId: a.content_id };
  }

  #locations(column: "m.id" | "m.thread_id", ids: number[]): MessageLocation[] {
    const out: MessageLocation[] = [];
    for (const part of chunks(ids)) {
      const marks = Sql.marks(part.length);
      const rows = this.q.all<{
        id: number; thread_id: number; account_id: string; provider: string; folder_id: number; path: string; role: string | null; uid: number;
        gm_msgid: string | null; message_id: string | null; seen: number; flagged: number; answered: number;
      }>(
        `SELECT m.id, m.thread_id, m.account_id, a.provider, m.folder_id, f.path, f.role, m.uid, m.gm_msgid, m.message_id, m.seen, m.flagged, m.answered
         FROM messages m JOIN folders f ON f.id = m.folder_id JOIN accounts a ON a.id = m.account_id
         WHERE ${column} IN (${marks}) ORDER BY m.thread_id, m.date, m.id`, ...part,
      );
      const members = new Map<number, number[]>();
      if (rows.length) {
        for (const mf of this.q.all<{ message_id: number; folder_id: number }>(
          `SELECT message_id, folder_id FROM message_folders WHERE message_id IN (${Sql.marks(rows.length)}) ORDER BY folder_id`, ...rows.map((r) => r.id),
        )) members.set(mf.message_id, [...(members.get(mf.message_id) ?? []), mf.folder_id]);
      }
      for (const r of rows) {
        out.push({
          messageRowId: r.id, threadId: r.thread_id, accountId: r.account_id, provider: r.provider as Provider, folderId: r.folder_id,
          folderPath: r.path, folderRole: (r.role as MailboxRole | null) ?? null, uid: r.uid, gmMsgid: r.gm_msgid, messageId: r.message_id,
          seen: bool(r.seen), flagged: bool(r.flagged), answered: bool(r.answered), memberFolderIds: members.get(r.id) ?? [],
        });
      }
    }
    return out;
  }
}
