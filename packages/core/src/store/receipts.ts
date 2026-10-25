import { FlintError, type ReceiptDetail, type ReceiptEventKind, type ReceiptRecipient, type ReceiptStatus, type ReceiptSummary, type ThreadId, type TrackedMessage } from "../types";
import { tx } from "../db/open";
import { chunks, Sql } from "./sql";
import { isPossiblyForwarded, recipientNote, recipientStatus, summarize } from "./receiptStatus";
import type { ReceiptChange } from "./types";

export type NewTracked = {
  accountId: string; ref: string; messageId: string; threadId: ThreadId | null; subject: string; sentAt: number;
  state?: "active" | "unregistered" | "stopped";
  recipients: { email: string; name?: string; token: string }[];
};

export type ReceiptEventInput = {
  remoteId: string; token: string; at: number; kind: ReceiptEventKind;
  client?: string | null; device?: string | null; location?: string | null; fingerprint?: string | null;
};

type TrackedRow = { id: number; account_id: string; ref: string; message_id: string; thread_id: number | null; subject: string; sent_at: number; state: string };
type RecipientRow = {
  id: number; tracked_id: number; email: string; name: string; status: string; first_open_at: number | null;
  last_open_at: number | null; open_count: number; replied_at: number | null; note: string | null;
};
type EventRow = { id: number; recipient_id: number; at: number; kind: string; client: string | null; device: string | null; location: string | null; fingerprint: string | null; counted: number };

export class ReceiptsRepo {
  constructor(protected q: Sql) {}

  createTracked(input: NewTracked): number {
    return tx(this.q.db, () => {
      const id = this.q.run(
        "INSERT INTO tracked_messages (account_id, ref, message_id, thread_id, subject, sent_at, state) VALUES (?,?,?,?,?,?,?)",
        input.accountId, input.ref, input.messageId, input.threadId, input.subject, input.sentAt, input.state ?? "active",
      ).lastInsertRowid;
      for (const r of input.recipients) {
        this.q.run("INSERT INTO tracked_recipients (tracked_id, email, name, token, status) VALUES (?,?,?,?,?)",
          id, r.email.toLowerCase(), r.name ?? "", r.token, input.state === "unregistered" ? "untracked" : "sent");
      }
      return id;
    });
  }

  /** Ties a sent message that was just synced back to its tracked row (by X-Flint-Ref, else Message-ID). */
  linkSentMessage(accountId: string, ref: string | null, messageId: string, threadId: ThreadId): void {
    this.q.run(
      "UPDATE tracked_messages SET thread_id = ? WHERE account_id = ? AND (ref = ? OR message_id = ?) AND (thread_id IS NULL OR thread_id <> ?)",
      threadId, accountId, ref ?? "", messageId, threadId,
    );
  }

  setTrackedState(trackedId: number, state: "active" | "unregistered" | "stopped"): void {
    this.q.run("UPDATE tracked_messages SET state = ? WHERE id = ?", state, trackedId);
    if (state === "unregistered") this.q.run("UPDATE tracked_recipients SET status = 'untracked' WHERE tracked_id = ? AND status = 'sent'", trackedId);
  }

  findTrackedByRef(ref: string): number | null {
    return this.q.get<{ id: number }>("SELECT id FROM tracked_messages WHERE ref = ?", ref)?.id ?? null;
  }

  findTrackedByMessageId(accountId: string, messageId: string): number | null {
    return this.q.get<{ id: number }>("SELECT id FROM tracked_messages WHERE account_id = ? AND message_id = ?", accountId, messageId)?.id ?? null;
  }

  /** Tracked messages the poller should still ask the service about. */
  listPollable(sinceMs: number): { trackedId: number; ref: string; sentAt: number }[] {
    return this.q.all<{ id: number; ref: string; sent_at: number }>("SELECT id, ref, sent_at FROM tracked_messages WHERE state = 'active' AND sent_at >= ? ORDER BY sent_at DESC", sinceMs)
      .map((r) => ({ trackedId: r.id, ref: r.ref, sentAt: r.sent_at }));
  }

  getTracked(trackedId: number): TrackedMessage | null {
    return this.#hydrate(this.q.all<TrackedRow>("SELECT * FROM tracked_messages WHERE id = ?", trackedId))[0] ?? null;
  }

  listTracked(opts: { limit?: number; status?: "opened" | "unopened" } = {}): TrackedMessage[] {
    const filter = opts.status === "opened"
      ? "WHERE EXISTS (SELECT 1 FROM tracked_recipients r WHERE r.tracked_id = t.id AND r.status IN ('opened','replied'))"
      : opts.status === "unopened"
        ? "WHERE NOT EXISTS (SELECT 1 FROM tracked_recipients r WHERE r.tracked_id = t.id AND r.status IN ('opened','replied'))"
        : "";
    const rows = this.q.all<TrackedRow>(`SELECT t.* FROM tracked_messages t ${filter} ORDER BY t.sent_at DESC, t.id DESC LIMIT ?`, Math.max(1, Math.min(opts.limit ?? 50, 500)));
    return this.#hydrate(rows);
  }

  getReceiptDetail(trackedId: number): ReceiptDetail {
    const tracked = this.getTracked(trackedId);
    if (!tracked) throw new FlintError("not_found", "That tracked message no longer exists.");
    const events = this.q.all<EventRow & { email: string }>(
      `SELECT e.*, r.email FROM receipt_events e JOIN tracked_recipients r ON r.id = e.recipient_id WHERE r.tracked_id = ? ORDER BY e.at DESC, e.id DESC`, trackedId,
    );
    return {
      trackedId, sentAt: tracked.sentAt, recipients: tracked.recipients,
      events: events.map((e) => ({ at: e.at, email: e.email, kind: e.kind as ReceiptEventKind, client: e.client, device: e.device, location: e.location, counted: e.counted === 1 })),
    };
  }

  getReceiptDetailForMessage(accountId: string, messageId: string): ReceiptDetail | null {
    const id = this.findTrackedByMessageId(accountId, messageId);
    return id === null ? null : this.getReceiptDetail(id);
  }

  /** Stores events from the receipts service (deduplicated by remote id) and recomputes affected recipients. Returns status or count changes. */
  ingestReceiptEvents(events: ReceiptEventInput[], now = Date.now()): ReceiptChange[] {
    return tx(this.q.db, () => {
      const touched = new Set<number>();
      for (const e of events) {
        const rec = this.q.get<{ id: number }>("SELECT id FROM tracked_recipients WHERE token = ?", e.token);
        if (!rec) continue;
        const r = this.q.run(
          "INSERT OR IGNORE INTO receipt_events (remote_id, recipient_id, at, kind, client, device, location, fingerprint, counted) VALUES (?,?,?,?,?,?,?,?,?)",
          e.remoteId, rec.id, e.at, e.kind, e.client ?? null, e.device ?? null, e.location ?? null, e.fingerprint ?? null, e.kind === "open",
        );
        if (r.changes > 0) touched.add(rec.id);
      }
      return [...touched].flatMap((id) => this.recomputeRecipient(id, now) ?? []);
    });
  }

  /** Re-derives every recipient of tracked mail in this thread (reply detection). Returns recipients whose status changed. */
  recomputeForThread(threadId: ThreadId, now = Date.now()): ReceiptChange[] {
    const ids = this.q.all<{ id: number }>("SELECT r.id FROM tracked_recipients r JOIN tracked_messages t ON t.id = r.tracked_id WHERE t.thread_id = ?", threadId);
    return ids.flatMap((r) => this.recomputeRecipient(r.id, now) ?? []);
  }

  /** SPEC section 6 app-side status: replied > opened > unknowable > sent. Returns a change record when status or open count moved. */
  recomputeRecipient(recipientId: number, now = Date.now()): ReceiptChange | null {
    const rec = this.q.get<RecipientRow & { thread_id: number | null; sent_at: number; state: string }>(
      "SELECT r.*, t.thread_id, t.sent_at, t.state FROM tracked_recipients r JOIN tracked_messages t ON t.id = r.tracked_id WHERE r.id = ?", recipientId,
    );
    if (!rec) return null;
    const events = this.q.all<EventRow>("SELECT * FROM receipt_events WHERE recipient_id = ? ORDER BY at, id", recipientId);
    const counted = events.filter((e) => e.counted === 1);
    let repliedAt = rec.replied_at;
    if (repliedAt === null && rec.thread_id !== null) {
      repliedAt = this.q.get<{ d: number | null }>(
        "SELECT MIN(date) AS d FROM messages WHERE thread_id = ? AND date > ? AND lower(json_extract(from_json, '$[0].address')) = ?",
        rec.thread_id, rec.sent_at, rec.email,
      )?.d ?? null;
    }
    const registered = rec.state === "active";
    const status = recipientStatus({ openCount: counted.length, repliedAt, sawPrefetch: events.some((e) => e.kind === "prefetch"), registered });
    const first = counted[0]?.at ?? null;
    const last = counted.length ? counted[counted.length - 1]!.at : null;
    const note = recipientNote(status, registered);
    this.q.run("UPDATE tracked_recipients SET status = ?, first_open_at = ?, last_open_at = ?, open_count = ?, replied_at = ?, note = ? WHERE id = ?",
      status, first, last, counted.length, repliedAt, note, recipientId);
    if (status === rec.status && counted.length === rec.open_count) return null;
    return { trackedId: rec.tracked_id, email: rec.email, status, at: status === "replied" ? repliedAt ?? now : last ?? now };
  }

  /** Receipt summary for each thread whose latest sent mail is tracked. `own` is the set of lowercase addresses that count as "me". */
  summariesForThreads(threadIds: ThreadId[], own: ReadonlySet<string>): Map<ThreadId, ReceiptSummary> {
    const out = new Map<ThreadId, ReceiptSummary>();
    if (threadIds.length === 0) return out;
    const rows = this.q.all<TrackedRow>(
      `SELECT t.* FROM tracked_messages t WHERE t.thread_id IN (${Sql.marks(threadIds.length)}) ORDER BY t.sent_at DESC, t.id DESC`, ...threadIds,
    );
    const latest = new Map<number, TrackedRow>();
    for (const r of rows) if (r.thread_id !== null && !latest.has(r.thread_id)) latest.set(r.thread_id, r);
    const ownList = [...own];
    for (const [threadId, t] of latest) {
      if (ownList.length) {
        const later = this.q.get<{ n: number }>(
          `SELECT 1 AS n FROM messages WHERE thread_id = ? AND date > ? AND message_id IS NOT ? AND draft = 0
             AND lower(json_extract(from_json, '$[0].address')) IN (${Sql.marks(ownList.length)}) LIMIT 1`,
          threadId, t.sent_at, t.message_id, ...ownList,
        );
        if (later) continue;
      }
      const recipients = this.q.all<RecipientRow>("SELECT * FROM tracked_recipients WHERE tracked_id = ?", t.id);
      out.set(threadId, summarize(recipients.map((r) => ({ status: r.status as ReceiptStatus, lastOpenAt: r.last_open_at }))));
    }
    return out;
  }

  #hydrate(tracked: TrackedRow[]): TrackedMessage[] {
    if (tracked.length === 0) return [];
    const ids = tracked.map((t) => t.id);
    const recipients: RecipientRow[] = [];
    const events: EventRow[] = [];
    for (const part of chunks(ids)) {
      recipients.push(...this.q.all<RecipientRow>(`SELECT * FROM tracked_recipients WHERE tracked_id IN (${Sql.marks(part.length)}) ORDER BY id`, ...part));
    }
    for (const part of chunks(recipients.map((r) => r.id))) {
      events.push(...this.q.all<EventRow>(`SELECT * FROM receipt_events WHERE recipient_id IN (${Sql.marks(part.length)}) AND counted = 1 ORDER BY at`, ...part));
    }
    const eventsByRecipient = new Map<number, EventRow[]>();
    for (const e of events) eventsByRecipient.set(e.recipient_id, [...(eventsByRecipient.get(e.recipient_id) ?? []), e]);
    const byTracked = new Map<number, ReceiptRecipient[]>();
    for (const r of recipients) {
      const mapped: ReceiptRecipient = {
        email: r.email, name: r.name, status: r.status as ReceiptStatus, firstOpenAt: r.first_open_at, lastOpenAt: r.last_open_at,
        openCount: r.open_count, repliedAt: r.replied_at, note: r.note,
        possiblyForwarded: isPossiblyForwarded((eventsByRecipient.get(r.id) ?? []).map((e) => ({ at: e.at, fingerprint: e.fingerprint, client: e.client }))),
      };
      byTracked.set(r.tracked_id, [...(byTracked.get(r.tracked_id) ?? []), mapped]);
    }
    return tracked.map((t) => {
      const recs = byTracked.get(t.id) ?? [];
      return {
        trackedId: t.id, accountId: t.account_id, threadId: t.thread_id, subject: t.subject, sentAt: t.sent_at,
        summary: summarize(recs), recipients: recs,
      };
    });
  }
}
