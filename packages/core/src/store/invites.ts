import type { InviteStore, ParsedInvite, StoredInvite, StoredResponse } from "../calendar/contracts";
import { seriesEnd } from "../calendar/recurrence";
import { localZone, wallIn } from "../calendar/zones";
import { roleMember } from "../search/sql";
import type { AccountId, MessageRowId, RsvpResponse, ThreadId } from "../types";

import { parseJson, Sql, type Param } from "./sql";

type InviteRow = {
  message_id: number; account_id: string; data_json: string; ics: string; parser_version: number; parsed_at: number;
};
type ResponseRow = {
  account_id: string; uid: string; recurrence_id: string; response: string; note: string | null; via: string; sequence: number; responded_at: number;
};

const COLUMNS = "i.message_id, i.account_id, i.data_json, i.ics, i.parser_version, i.parsed_at";

/** An attachment that carries a calendar: a text/calendar part or any .ics file. */
const CALENDAR_ATTACHMENT = `(a.content_type IN ('text/calendar', 'application/ics', 'text/x-vcalendar', 'application/x-ics') OR LOWER(a.filename) LIKE '%.ics')`;

const toStored = (r: InviteRow): StoredInvite => ({
  messageId: r.message_id, accountId: r.account_id, invite: parseJson<ParsedInvite>(r.data_json, null as never), ics: r.ics,
  parserVersion: r.parser_version, parsedAt: r.parsed_at,
});

const toResponse = (r: ResponseRow): StoredResponse => ({
  accountId: r.account_id, uid: r.uid, recurrenceId: r.recurrence_id, response: r.response as RsvpResponse, note: r.note,
  via: r.via as StoredResponse["via"], sequence: r.sequence, respondedAt: r.responded_at,
});

export type CalendarAttachment = { id: number; part: string; filename: string; contentType: string; size: number };

/** Parsed calendar invitations, one per message, and the user's own answers per event. See calendar/contracts.ts. */
export class InvitesRepo implements InviteStore {
  constructor(protected q: Sql) {}

  saveInvite(input: Omit<StoredInvite, "parsedAt"> & { parsedAt: number }): void {
    const inv = input.invite;
    this.q.run(
      `INSERT OR REPLACE INTO invites (message_id, account_id, uid, recurrence_id, method, sequence, dtstamp, start_at, end_at, data_json, ics, parser_version, parsed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      input.messageId, input.accountId, inv.uid, inv.recurrenceId ?? "", inv.method, inv.sequence, inv.dtstamp,
      inv.start, this.#seriesEnd(inv), JSON.stringify(inv), input.ics, input.parserVersion, input.parsedAt,
    );
    this.q.run("UPDATE messages SET invite_checked = 1 WHERE id = ?", input.messageId);
  }

  /** end_at is when the last occurrence ends; null for a series that never ends (it stays "upcoming"). */
  #seriesEnd(inv: ParsedInvite): number | null {
    if (!inv.recurrence) return inv.end;
    if (!/(^|;)(UNTIL|COUNT)=/i.test(inv.recurrence.rrule)) return null;
    const zone = inv.allDay ? "UTC" : inv.timeZone ?? localZone();
    return seriesEnd(inv.recurrence.rrule, wallIn(inv.start, zone), zone, Math.max(0, inv.end - inv.start)) ?? inv.end;
  }

  getStoredInvite(messageId: MessageRowId): StoredInvite | null {
    const r = this.q.get<InviteRow>(`SELECT ${COLUMNS} FROM invites i WHERE i.message_id = ?`, messageId);
    return r ? toStored(r) : null;
  }

  markInviteChecked(messageIds: MessageRowId[]): void {
    for (const id of messageIds) this.q.run("UPDATE messages SET invite_checked = 1 WHERE id = ?", id);
  }

  uncheckedInviteMessages(limit: number): { messageId: MessageRowId; accountId: AccountId }[] {
    return this.q.all<{ id: number; account_id: string }>(
      `SELECT m.id, m.account_id FROM messages m
       WHERE m.invite_checked = 0 AND m.draft = 0
         AND NOT EXISTS (SELECT 1 FROM invites i WHERE i.message_id = m.id)
         AND EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id AND ${CALENDAR_ATTACHMENT})
       ORDER BY m.date DESC LIMIT ?`, limit,
    ).map((r) => ({ messageId: r.id, accountId: r.account_id }));
  }

  /** Whether the message was already scanned for a calendar part (or has a stored invite). */
  isInviteChecked(messageId: MessageRowId): boolean {
    return this.q.get<{ c: number }>("SELECT invite_checked AS c FROM messages WHERE id = ?", messageId)?.c === 1;
  }

  /** The calendar parts and .ics files of one message, oldest first. */
  calendarAttachments(messageId: MessageRowId): CalendarAttachment[] {
    return this.q.all<{ id: number; part: string; filename: string; content_type: string; size: number }>(
      `SELECT a.id, a.part, a.filename, a.content_type, a.size FROM attachments a WHERE a.message_id = ? AND ${CALENDAR_ATTACHMENT} ORDER BY a.id`, messageId,
    ).map((r) => ({ id: r.id, part: r.part, filename: r.filename, contentType: r.content_type, size: r.size }));
  }

  invitesForEvent(accountId: AccountId, uid: string, recurrenceId: string): StoredInvite[] {
    return this.q.all<InviteRow>(
      `SELECT ${COLUMNS} FROM invites i JOIN messages m ON m.id = i.message_id
       WHERE i.account_id = ? AND i.uid = ? AND i.recurrence_id = ? AND NOT ${roleMember("trash")} AND NOT ${roleMember("spam")}
       ORDER BY i.sequence DESC, COALESCE(i.dtstamp, 0) DESC, (i.method = 'CANCEL') DESC, i.message_id DESC`,
      accountId, uid, recurrenceId,
    ).map(toStored);
  }

  /** Stored invites of the given threads with the thread each came from (for list chips). */
  invitesForThreads(threadIds: ThreadId[]): (StoredInvite & { threadId: ThreadId; messageDate: number })[] {
    if (threadIds.length === 0) return [];
    return this.q.all<InviteRow & { thread_id: number; date: number }>(
      `SELECT ${COLUMNS}, m.thread_id, m.date FROM invites i JOIN messages m ON m.id = i.message_id
       WHERE m.thread_id IN (${Sql.marks(threadIds.length)}) AND m.draft = 0 ORDER BY m.date, m.id`, ...threadIds,
    ).map((r) => ({ ...toStored(r), threadId: r.thread_id, messageDate: r.date }));
  }

  getResponse(accountId: AccountId, uid: string, recurrenceId: string): StoredResponse | null {
    const r = this.q.get<ResponseRow>("SELECT * FROM invite_responses WHERE account_id = ? AND uid = ? AND recurrence_id = ?", accountId, uid, recurrenceId);
    return r ? toResponse(r) : null;
  }

  setResponse(r: StoredResponse): void {
    this.q.run(
      `INSERT OR REPLACE INTO invite_responses (account_id, uid, recurrence_id, response, note, via, sequence, responded_at) VALUES (?,?,?,?,?,?,?,?)`,
      r.accountId, r.uid, r.recurrenceId, r.response, r.note, r.via, r.sequence, r.respondedAt,
    );
  }

  upcomingInvites(opts: { accountId?: AccountId; from: number; to: number | null; limit: number }): StoredInvite[] {
    const params: Param[] = [];
    const filters = ["rn = 1", "method IN ('REQUEST', 'PUBLISH')", "COALESCE(end_at, 9007199254740991) >= ?"];
    // All-day ends are midnight UTC; a viewer west of UTC is still inside the last day after that, so look a day back and let the caller decide.
    params.push(opts.from - 86_400_000);
    if (opts.accountId) { filters.push("account_id = ?"); params.push(opts.accountId); }
    if (opts.to !== null) { filters.push("start_at < ?"); params.push(opts.to); }
    return this.q.all<InviteRow & { rn: number; method: string; end_at: number | null; start_at: number }>(
      `WITH ranked AS (
         SELECT i.*, ROW_NUMBER() OVER (
           PARTITION BY i.account_id, i.uid, i.recurrence_id
           ORDER BY i.sequence DESC, COALESCE(i.dtstamp, 0) DESC, (i.method = 'CANCEL') DESC, i.message_id DESC) AS rn
         FROM invites i JOIN messages m ON m.id = i.message_id
         WHERE i.method IN ('REQUEST', 'PUBLISH', 'CANCEL') AND NOT ${roleMember("trash")} AND NOT ${roleMember("spam")})
       SELECT message_id, account_id, data_json, ics, parser_version, parsed_at FROM ranked
       WHERE ${filters.join(" AND ")} ORDER BY start_at, message_id LIMIT ?`, ...params, opts.limit,
    ).map(toStored);
  }
}
