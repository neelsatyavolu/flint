import { categorize } from "../categorize";
import { tx } from "../db/open";
import { evaluateRules, resolveCategory, senderMatchesBlocked, type RuleMessage } from "../rules";
import { cleanMessageId } from "../threading";
import { FlintError, type Account, type AccountId, type Address, type Category, type Folder, type FolderId, type MessageRowId, type Rule, type RuleAction, type ThreadId } from "../types";
import type { AccountsRepo } from "./accounts";
import type { ContactsRepo } from "./contacts";
import type { FoldersRepo } from "./folders";
import { bodyTextFor, snippetFrom, writeFts } from "./fts";
import { addresses, lowerAddr } from "./mappers";
import type { ReceiptsRepo } from "./receipts";
import { deleteMessages, recomputeThreads } from "./rollup";
import type { RulesRepo } from "./rulesRepo";
import { chunks, Sql } from "./sql";
import { resolveThread } from "./threadResolve";
import type { FlagUpdate, IngestAttachment, IngestContext, IngestMessage, IngestOutcome, MessageBody } from "./types";

type Existing = {
  id: number; thread_id: number; folder_id: number; uid: number; category: string | null;
  subject: string; from_json: string; to_json: string; cc_json: string; snippet: string;
};
const EXISTING_COLS = "id, thread_id, folder_id, uid, category, subject, from_json, to_json, cc_json, snippet";

type Run = {
  account: Account; folder: Folder; own: Set<string>; evaluate: boolean; rules: Rule[]; blocked: Set<string>;
  folders: Map<string, { id: number; role: string | null }>; touched: Set<ThreadId>; now: number;
};

export class IngestRepo {
  constructor(
    protected q: Sql,
    private accounts: AccountsRepo,
    private folders: FoldersRepo,
    private contacts: ContactsRepo,
    private rulesRepo: RulesRepo,
    private receipts: ReceiptsRepo,
  ) {}

  /**
   * Stores a batch of server messages in one transaction: threading, rows, folder membership, attachments,
   * search index, contacts, category, blocked-sender and rule evaluation, then thread rollups.
   */
  ingestMessages(accountId: AccountId, folderId: FolderId, items: IngestMessage[], ctx: IngestContext = {}): IngestOutcome[] {
    return tx(this.q.db, () => {
      const account = this.accounts.requireAccount(accountId);
      const folder = this.folders.requireFolder(folderId);
      if (folder.accountId !== accountId) throw new FlintError("invalid", "That folder belongs to a different account.");
      const evaluate = ctx.evaluate !== false;
      const run: Run = {
        account, folder, own: this.accounts.ownAddresses(), evaluate, now: ctx.now ?? Date.now(),
        rules: evaluate ? this.rulesRepo.listRulesFor(accountId) : [],
        blocked: evaluate ? this.rulesRepo.blockedPatterns() : new Set(),
        folders: this.#folderMap(accountId), touched: new Set(),
      };
      const outcomes = items.map((item) => this.#ingestOne(run, item));
      recomputeThreads(this.q, run.touched);
      this.#attachReceiptChanges(run, outcomes);
      return outcomes;
    });
  }

  setBody(messageRowId: MessageRowId, body: MessageBody): void {
    tx(this.q.db, () => {
      const row = this.q.get<Existing>(`SELECT ${EXISTING_COLS} FROM messages WHERE id = ?`, messageRowId);
      if (!row) throw new FlintError("not_found", "That message no longer exists.");
      this.#writeBody(row, body.text, body.html);
      if (body.attachments) this.#replaceAttachments(row.id, body.attachments);
    });
  }

  /** Applies server flag changes keyed by (folder, uid). Returns the threads whose pin state may have changed. */
  applyFlags(folderId: FolderId, updates: FlagUpdate[]): ThreadId[] {
    return tx(this.q.db, () => {
      const changed = new Set<ThreadId>();
      const pinChanged = new Set<ThreadId>();
      for (const u of updates) {
        const r = this.q.get<{ id: number; thread_id: number; seen: number; flagged: number; answered: number; draft: number }>(
          "SELECT id, thread_id, seen, flagged, answered, draft FROM messages WHERE folder_id = ? AND uid = ?", folderId, u.uid,
        );
        if (!r) continue;
        const next = {
          seen: u.seen ?? r.seen === 1, flagged: u.flagged ?? r.flagged === 1,
          answered: u.answered ?? r.answered === 1, draft: u.draft ?? r.draft === 1,
        };
        if (next.seen === (r.seen === 1) && next.flagged === (r.flagged === 1) && next.answered === (r.answered === 1) && next.draft === (r.draft === 1)) continue;
        this.q.run("UPDATE messages SET seen = ?, flagged = ?, answered = ?, draft = ? WHERE id = ?", next.seen, next.flagged, next.answered, next.draft, r.id);
        changed.add(r.thread_id);
        if (next.flagged !== (r.flagged === 1)) pinChanged.add(r.thread_id);
      }
      recomputeThreads(this.q, pinChanged);
      return [...changed];
    });
  }

  /** Gmail: replaces label membership (labels are folder paths) for messages located at (folder, uid). Returns changed thread ids. */
  applyGmailLabels(folderId: FolderId, updates: { uid: number; labels: string[] }[]): ThreadId[] {
    return tx(this.q.db, () => {
      const folder = this.folders.requireFolder(folderId);
      const map = this.#folderMap(folder.accountId);
      const changed = new Set<ThreadId>();
      for (const u of updates) {
        const r = this.q.get<{ id: number; thread_id: number }>("SELECT id, thread_id FROM messages WHERE folder_id = ? AND uid = ?", folderId, u.uid);
        if (!r) continue;
        const next = this.#membership(folder.accountId, map, folderId, u.labels);
        const cur = this.q.all<{ folder_id: number }>("SELECT folder_id FROM message_folders WHERE message_id = ?", r.id).map((x) => x.folder_id);
        if (cur.length === next.length && next.every((id) => cur.includes(id))) continue;
        this.#setMembership(r.id, next);
        changed.add(r.thread_id);
      }
      return [...changed];
    });
  }

  /** Server expunged these UIDs from the folder. Deletes the rows located there. Returns affected thread ids. */
  removeUids(folderId: FolderId, uids: number[]): ThreadId[] {
    return tx(this.q.db, () => {
      const ids: number[] = [];
      for (const part of chunks(uids)) {
        ids.push(...this.q.all<{ id: number }>(`SELECT id FROM messages WHERE folder_id = ? AND uid IN (${Sql.marks(part.length)})`, folderId, ...part).map((r) => r.id));
      }
      return deleteMessages(this.q, ids);
    });
  }

  /** UIDs of messages located in this folder, ascending, optionally from minUid up. */
  listLocalUids(folderId: FolderId, minUid?: number): number[] {
    return this.q.all<{ uid: number }>("SELECT uid FROM messages WHERE folder_id = ? AND uid >= ? ORDER BY uid", folderId, minUid ?? 0).map((r) => r.uid);
  }

  // ---- internals

  #folderMap(accountId: AccountId): Map<string, { id: number; role: string | null }> {
    return new Map(this.q.all<{ id: number; path: string; role: string | null }>("SELECT id, path, role FROM folders WHERE account_id = ?", accountId).map((f) => [f.path, { id: f.id, role: f.role }]));
  }

  /** Folder ids a message belongs to: the folder it was seen in plus (Gmail) its label folders, created on demand. */
  #membership(accountId: AccountId, map: Map<string, { id: number; role: string | null }>, seenIn: FolderId, labels: string[] | undefined): number[] {
    const set = new Set<number>([seenIn]);
    for (const path of labels ?? []) {
      let f = map.get(path);
      if (!f) {
        const created = this.folders.upsertFolder(accountId, { path });
        f = { id: created.id, role: created.role };
        map.set(path, f);
      }
      set.add(f.id);
    }
    return [...set];
  }

  #setMembership(messageId: number, folderIds: number[]): void {
    this.q.run("DELETE FROM message_folders WHERE message_id = ?", messageId);
    for (const id of folderIds) this.q.run("INSERT OR IGNORE INTO message_folders (message_id, folder_id) VALUES (?,?)", messageId, id);
  }

  #findExisting(run: Run, folderId: FolderId, item: IngestMessage, messageId: string | null): Existing | undefined {
    if (run.account.provider === "gmail" && item.gmMsgid) {
      const r = this.q.get<Existing>(`SELECT ${EXISTING_COLS} FROM messages WHERE account_id = ? AND gm_msgid = ?`, run.account.id, item.gmMsgid);
      if (r) return r;
    }
    const byUid = this.q.get<Existing>(`SELECT ${EXISTING_COLS} FROM messages WHERE folder_id = ? AND uid = ?`, folderId, item.uid);
    if (byUid || run.account.provider === "gmail" || !messageId) return byUid;
    // Optimistic local move: the row still points at the source folder but is already a member of this one.
    return this.q.get<Existing>(
      `SELECT ${EXISTING_COLS.split(", ").map((c) => `m.${c}`).join(", ")} FROM messages m JOIN message_folders mf ON mf.message_id = m.id
       WHERE m.account_id = ? AND m.message_id = ? AND mf.folder_id = ? AND m.folder_id <> ? LIMIT 1`,
      run.account.id, messageId, folderId, folderId,
    );
  }

  #ingestOne(run: Run, item: IngestMessage): IngestOutcome {
    const messageId = cleanMessageId(item.messageId);
    const msg: IngestMessage = {
      ...item, messageId, inReplyTo: cleanMessageId(item.inReplyTo),
      references: item.references.map(cleanMessageId).filter((v): v is string => v !== null),
    };
    const sender = msg.from[0];
    const fromMe = msg.from.some((a) => run.own.has(lowerAddr(a)));
    const existing = this.#findExisting(run, run.folder.id, msg, messageId);
    return existing ? this.#updateExisting(run, existing, msg, fromMe) : this.#insertNew(run, msg, fromMe, sender);
  }

  #updateExisting(run: Run, row: Existing, msg: IngestMessage, fromMe: boolean): IngestOutcome {
    const gmail = run.account.provider === "gmail";
    const moved = row.folder_id !== run.folder.id || row.uid !== msg.uid;
    if (moved) {
      const clash = this.q.get<{ id: number }>("SELECT id FROM messages WHERE folder_id = ? AND uid = ? AND id <> ?", run.folder.id, msg.uid, row.id);
      if (clash) for (const t of deleteMessages(this.q, [clash.id])) run.touched.add(t);
    }
    this.q.run(
      `UPDATE messages SET folder_id = ?, uid = ?, gm_msgid = COALESCE(?, gm_msgid), gm_thrid = COALESCE(?, gm_thrid),
         seen = ?, flagged = ?, answered = ?, draft = ?, has_attachments = ?, size = ? WHERE id = ?`,
      run.folder.id, msg.uid, msg.gmMsgid ?? null, msg.gmThrid ?? null,
      msg.flags.seen, msg.flags.flagged, msg.flags.answered, msg.flags.draft, msg.hasAttachments, msg.size, row.id,
    );
    if (Object.keys(msg.headers).length) this.q.run("UPDATE messages SET headers_json = ? WHERE id = ?", JSON.stringify(msg.headers), row.id);
    if (msg.textBody != null || msg.htmlBody != null) this.#writeBody(row, msg.textBody ?? null, msg.htmlBody ?? null);
    if (msg.attachments && this.q.get<{ n: number }>("SELECT COUNT(*) AS n FROM attachments WHERE message_id = ?", row.id)!.n === 0) this.#replaceAttachments(row.id, msg.attachments);

    const labels = gmail ? msg.gmLabels : undefined;
    if (labels || moved) {
      this.#setMembership(row.id, this.#membership(run.account.id, run.folders, run.folder.id, labels));
    } else {
      this.q.run("INSERT OR IGNORE INTO message_folders (message_id, folder_id) VALUES (?,?)", row.id, run.folder.id);
    }
    run.touched.add(row.thread_id);
    return {
      uid: msg.uid, messageRowId: row.id, threadId: row.thread_id, isNew: false,
      category: (row.category as Category | null) ?? "people", fromMe, blocked: false,
      ruleActions: [], mergedThreadIds: [], receiptChanges: [],
    };
  }

  #insertNew(run: Run, msg: IngestMessage, fromMe: boolean, sender: Address | undefined): IngestOutcome {
    const { threadId, mergedThreadIds } = resolveThread(this.q, run.account.id, run.folder.id, msg, run.own);
    const isKnown = fromMe || (sender ? this.contacts.hasSentTo(sender.address) : false);
    let category = categorize({ from: sender ?? null, headers: msg.headers, isKnownContact: isKnown, subject: msg.subject });
    const hasBody = msg.textBody != null || msg.htmlBody != null;
    const bodyText = hasBody ? bodyTextFor(msg.textBody, msg.htmlBody) : "";
    const snippet = msg.snippet ?? snippetFrom(bodyText);

    const id = this.q.run(
      `INSERT INTO messages (account_id, thread_id, folder_id, uid, gm_msgid, gm_thrid, message_id, in_reply_to, refs, subject,
         from_json, to_json, cc_json, bcc_json, reply_to_json, date, snippet, seen, flagged, answered, draft,
         has_attachments, size, headers_json, body_state, text_body, html_body, category)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      run.account.id, threadId, run.folder.id, msg.uid, msg.gmMsgid ?? null, msg.gmThrid ?? null, msg.messageId, msg.inReplyTo,
      JSON.stringify(msg.references), msg.subject, JSON.stringify(msg.from), JSON.stringify(msg.to), JSON.stringify(msg.cc),
      JSON.stringify(msg.bcc), JSON.stringify(msg.replyTo), msg.date, snippet, msg.flags.seen, msg.flags.flagged, msg.flags.answered,
      msg.flags.draft, msg.hasAttachments, msg.size, JSON.stringify(msg.headers), hasBody ? "full" : "none",
      msg.textBody ?? null, msg.htmlBody ?? null, category,
    ).lastInsertRowid;

    const labels = run.account.provider === "gmail" ? msg.gmLabels : undefined;
    const memberIds = this.#membership(run.account.id, run.folders, run.folder.id, labels);
    this.#setMembership(id, memberIds);
    if (msg.attachments?.length) this.#replaceAttachments(id, msg.attachments);
    writeFts(this.q, id, { subject: msg.subject, from: msg.from, to: msg.to, cc: msg.cc, body: bodyText });

    if (!msg.flags.draft) this.#updateContacts(run, msg, fromMe);
    if (fromMe && msg.messageId) this.receipts.linkSentMessage(run.account.id, msg.headers["x-flint-ref"] ?? null, msg.messageId, threadId);

    let blocked = false;
    let actions: RuleAction[] = [];
    if (run.evaluate && !fromMe && !msg.flags.draft) {
      blocked = sender ? senderMatchesBlocked(sender.address, run.blocked) : false;
      const inInbox = memberIds.some((fid) => [...run.folders.values()].some((f) => f.id === fid && f.role === "inbox"));
      if (!blocked && inInbox) {
        actions = evaluateRules(run.rules, this.#ruleMessage(run.account.id, msg, bodyText));
        const resolved = resolveCategory(actions, category);
        if (resolved !== category) {
          category = resolved;
          this.q.run("UPDATE messages SET category = ? WHERE id = ?", category, id);
        }
        if (actions.some((a) => a.type === "mute")) this.q.run("UPDATE threads SET muted = 1 WHERE id = ?", threadId);
      }
    }
    run.touched.add(threadId);
    return { uid: msg.uid, messageRowId: id, threadId, isNew: true, category, fromMe, blocked, ruleActions: actions, mergedThreadIds, receiptChanges: [] };
  }

  #ruleMessage(accountId: string, msg: IngestMessage, body: string): RuleMessage {
    return { accountId, from: msg.from, to: msg.to, cc: msg.cc, bcc: msg.bcc, subject: msg.subject, body, headers: msg.headers, hasAttachments: msg.hasAttachments };
  }

  #updateContacts(run: Run, msg: IngestMessage, fromMe: boolean): void {
    if (fromMe) {
      for (const a of [...msg.to, ...msg.cc, ...msg.bcc]) if (!run.own.has(lowerAddr(a))) this.contacts.touchSent(a, msg.date);
    } else {
      for (const a of msg.from) this.contacts.touchReceived(a, msg.date);
    }
  }

  #writeBody(row: Existing, text: string | null, html: string | null): void {
    const body = bodyTextFor(text, html);
    const snippet = row.snippet || snippetFrom(body);
    this.q.run("UPDATE messages SET text_body = ?, html_body = ?, body_state = 'full', snippet = ? WHERE id = ?", text, html, snippet, row.id);
    writeFts(this.q, row.id, { subject: row.subject, from: addresses(row.from_json), to: addresses(row.to_json), cc: addresses(row.cc_json), body });
  }

  #replaceAttachments(messageId: number, list: IngestAttachment[]): void {
    this.q.run("DELETE FROM attachments WHERE message_id = ?", messageId);
    for (const a of list) {
      this.q.run("INSERT INTO attachments (message_id, part, filename, content_type, size, content_id, inline) VALUES (?,?,?,?,?,?,?)",
        messageId, a.part, a.filename, a.contentType, a.size, a.contentId, a.inline);
    }
    this.q.run("UPDATE messages SET has_attachments = ? WHERE id = ?", list.some((a) => !a.inline), messageId);
  }

  #attachReceiptChanges(run: Run, outcomes: IngestOutcome[]): void {
    const seen = new Set<ThreadId>();
    for (let i = outcomes.length - 1; i >= 0; i--) {
      const o = outcomes[i]!;
      if (!o.isNew || o.fromMe || seen.has(o.threadId)) continue;
      seen.add(o.threadId);
      o.receiptChanges = this.receipts.recomputeForThread(o.threadId, run.now);
    }
  }
}
