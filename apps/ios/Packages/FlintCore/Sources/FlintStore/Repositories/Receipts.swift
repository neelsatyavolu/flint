// Tracked messages, recipients and service events. Ported from store/receipts.ts; status derivation is in
// Support/ReceiptStatusLogic.swift (shared fixture receipts-status.json).

import FlintModel
import Foundation
import GRDB

enum ReceiptsSQL {
    static func createTracked(_ db: Database, _ input: NewTracked) throws -> Int {
        let id = try db.insert(
            "INSERT INTO tracked_messages (account_id, ref, message_id, thread_id, subject, sent_at, state, untracked_reason) VALUES (?,?,?,?,?,?,?,?)",
            input.accountId, input.ref, input.messageId, input.threadId, input.subject, input.sentAt, input.state.rawValue, input.untrackedReason)
        let unregistered = input.state == .unregistered
        for r in input.recipients {
            try db.run(
                "INSERT INTO tracked_recipients (tracked_id, email, name, token, status, note) VALUES (?,?,?,?,?,?)",
                id, r.email.lowercased(), r.name, r.token, unregistered ? "untracked" : "sent", unregistered ? input.untrackedReason : nil)
        }
        return id
    }

    /// Ties a sent message that was just synced back to its tracked row (by X-Flint-Ref, else Message-ID).
    static func linkSent(_ db: Database, accountId: AccountID, ref: String?, messageId: String, threadId: ThreadID) throws {
        try db.run(
            "UPDATE tracked_messages SET thread_id = ? WHERE account_id = ? AND (ref = ? OR message_id = ?) AND (thread_id IS NULL OR thread_id <> ?)",
            threadId, accountId, ref ?? "", messageId, threadId)
    }

    // MARK: Hydration

    private struct TrackedRow {
        var id: Int, accountId: String, threadId: Int?, subject: String, sentAt: Int, messageId: String

        init(_ r: Row) {
            id = r["id"]; accountId = r["account_id"]; threadId = r["thread_id"]; subject = r["subject"]
            sentAt = r["sent_at"]; messageId = r["message_id"]
        }
    }

    private static func tracked(_ db: Database, _ rows: [Row]) throws -> [TrackedMessage] {
        if rows.isEmpty { return [] }
        let tracked = rows.map(TrackedRow.init)
        var recipients: [Row] = []
        for part in tracked.map(\.id).chunked() {
            let args: [SQLArg] = part
            recipients += try db.all("SELECT * FROM tracked_recipients WHERE tracked_id IN (\(SQL.marks(part.count))) ORDER BY id", args: args)
        }
        var events: [Int: [ReceiptStatusLogic.Event]] = [:]
        for part in recipients.map({ $0["id"] as Int }).chunked() {
            let args: [SQLArg] = part
            for e in try db.all("SELECT recipient_id, at, kind, client, fingerprint FROM receipt_events WHERE recipient_id IN (\(SQL.marks(part.count))) AND counted = 1 ORDER BY at", args: args) {
                events[e["recipient_id"], default: []].append(.init(at: e["at"], kind: .open, client: e["client"], fingerprint: e["fingerprint"]))
            }
        }
        var byTracked: [Int: [ReceiptRecipient]] = [:]
        for r in recipients {
            let id: Int = r["id"]
            byTracked[r["tracked_id"] as Int, default: []].append(ReceiptRecipient(
                email: r["email"], name: r["name"], status: ReceiptStatus(rawValue: r["status"]) ?? .sent, firstOpenAt: r["first_open_at"],
                lastOpenAt: r["last_open_at"], openCount: r["open_count"], repliedAt: r["replied_at"], note: r["note"],
                possiblyForwarded: ReceiptStatusLogic.isPossiblyForwarded(events[id] ?? [])))
        }
        return tracked.map { t in
            let recs = byTracked[t.id] ?? []
            return TrackedMessage(
                trackedId: t.id, accountId: t.accountId, threadId: t.threadId, subject: t.subject, sentAt: t.sentAt,
                summary: ReceiptStatusLogic.summarize(recs.map { ($0.status, $0.lastOpenAt) }), recipients: recs)
        }
    }

    static func tracked(_ db: Database, id: Int) throws -> TrackedMessage? {
        try tracked(db, try db.all("SELECT * FROM tracked_messages WHERE id = ?", id)).first
    }

    /// `unopenedOnly`: nil lists all, true lists mail nobody opened or replied to, false lists mail somebody did.
    static func list(_ db: Database, limit: Int?, unopenedOnly: Bool?) throws -> [TrackedMessage] {
        let opened = "EXISTS (SELECT 1 FROM tracked_recipients r WHERE r.tracked_id = t.id AND r.status IN ('opened','replied'))"
        let filter = unopenedOnly.map { $0 ? "WHERE NOT \(opened)" : "WHERE \(opened)" } ?? ""
        let cap = max(1, min(limit ?? 50, 500))
        return try tracked(db, try db.all("SELECT t.* FROM tracked_messages t \(filter) ORDER BY t.sent_at DESC, t.id DESC LIMIT ?", cap))
    }

    static func detail(_ db: Database, trackedId: Int) throws -> ReceiptDetail {
        guard let t = try tracked(db, id: trackedId) else { throw FlintError(.notFound, "That tracked message no longer exists.") }
        let events = try db.all(
            "SELECT e.*, r.email FROM receipt_events e JOIN tracked_recipients r ON r.id = e.recipient_id WHERE r.tracked_id = ? ORDER BY e.at DESC, e.id DESC",
            trackedId
        ).map {
            ReceiptEvent(
                at: $0["at"], email: $0["email"], kind: ReceiptEventKind(rawValue: $0["kind"]) ?? .open, client: $0["client"],
                device: $0["device"], location: $0["location"], counted: $0.bool("counted"))
        }
        return ReceiptDetail(trackedId: trackedId, sentAt: t.sentAt, recipients: t.recipients, events: events)
    }

    // MARK: Events and status

    /// Stores events from the receipts service (deduplicated by remote id) and recomputes affected recipients.
    static func ingest(_ db: Database, _ events: [ReceiptEventInput], now: EpochMs) throws -> [ReceiptChange] {
        var touched: [Int] = []
        for e in events {
            guard let rec = try Int.fetchOne(db, sql: "SELECT id FROM tracked_recipients WHERE token = ?", arguments: [e.token]) else { continue }
            let inserted = try db.run(
                "INSERT OR IGNORE INTO receipt_events (remote_id, recipient_id, at, kind, client, device, location, fingerprint, counted) VALUES (?,?,?,?,?,?,?,?,?)",
                e.remoteId, rec, e.at, e.kind.rawValue, e.client, e.device, e.location, e.fingerprint, e.kind == .open)
            if inserted > 0 && !touched.contains(rec) { touched.append(rec) }
        }
        return try touched.compactMap { try recompute(db, recipientId: $0, now: now) }
    }

    /// Re-derives every recipient of tracked mail in this thread (reply detection). Returns recipients whose status changed.
    static func recompute(_ db: Database, threadId: ThreadID, now: EpochMs) throws -> [ReceiptChange] {
        let ids = try db.all("SELECT r.id FROM tracked_recipients r JOIN tracked_messages t ON t.id = r.tracked_id WHERE t.thread_id = ?", threadId)
        return try ids.compactMap { try recompute(db, recipientId: $0["id"], now: now) }
    }

    /// SPEC section 6 app-side status: replied > opened > unknowable > sent. Returns a change when status or open count moved.
    static func recompute(_ db: Database, recipientId: Int, now: EpochMs) throws -> ReceiptChange? {
        guard let rec = try db.first(
            """
            SELECT r.*, t.thread_id, t.sent_at, t.state, t.untracked_reason FROM tracked_recipients r
            JOIN tracked_messages t ON t.id = r.tracked_id WHERE r.id = ?
            """, recipientId)
        else { return nil }
        let events = try db.all("SELECT at, kind, client, fingerprint FROM receipt_events WHERE recipient_id = ? ORDER BY at, id", recipientId).map {
            ReceiptStatusLogic.Event(at: $0["at"], kind: ReceiptEventKind(rawValue: $0["kind"]) ?? .duplicate, client: $0["client"], fingerprint: $0["fingerprint"])
        }
        var repliedAt: Int? = rec["replied_at"]
        let threadId: Int? = rec["thread_id"]
        if repliedAt == nil, let threadId {
            repliedAt = try Int.fetchOne(
                db, sql: "SELECT MIN(date) FROM messages WHERE thread_id = ? AND date > ? AND lower(json_extract(from_json, '$[0].address')) = ?",
                arguments: [threadId, rec["sent_at"] as Int, rec["email"] as String])
        }
        let registered = (rec["state"] as String) == "active"
        let derived = ReceiptStatusLogic.derive(
            events: events, repliedAt: repliedAt, registered: registered, untrackedReason: rec["untracked_reason"])
        try db.run(
            "UPDATE tracked_recipients SET status = ?, first_open_at = ?, last_open_at = ?, open_count = ?, replied_at = ?, note = ? WHERE id = ?",
            derived.status.rawValue, derived.firstOpenAt, derived.lastOpenAt, derived.openCount, repliedAt, derived.note, recipientId)
        if derived.status.rawValue == (rec["status"] as String) && derived.openCount == (rec["open_count"] as Int) { return nil }
        return ReceiptChange(
            trackedId: rec["tracked_id"], email: rec["email"], status: derived.status.rawValue,
            at: derived.status == .replied ? (repliedAt ?? now) : (derived.lastOpenAt ?? now))
    }

    /// Receipt summary for each thread whose latest sent mail is tracked.
    static func summaries(_ db: Database, threadIds: [ThreadID], own: Set<String>) throws -> [ThreadID: ReceiptSummary] {
        var out: [ThreadID: ReceiptSummary] = [:]
        if threadIds.isEmpty { return out }
        let marks = SQL.marks(threadIds.count)
        let ids: [SQLArg] = threadIds
        let rows = try db.all("SELECT t.* FROM tracked_messages t WHERE t.thread_id IN (\(marks)) ORDER BY t.sent_at DESC, t.id DESC", args: ids)
        var latest: [Int: Row] = [:]
        for r in rows { if let t: Int = r["thread_id"], latest[t] == nil { latest[t] = r } }
        let ownList = own.sorted()
        for (threadId, t) in latest {
            if !ownList.isEmpty {
                let args: [SQLArg] = [threadId, t["sent_at"] as Int, t["message_id"] as String] + ownList
                let later = try db.first(
                    """
                    SELECT 1 AS n FROM messages WHERE thread_id = ? AND date > ? AND message_id IS NOT ? AND draft = 0
                      AND lower(json_extract(from_json, '$[0].address')) IN (\(SQL.marks(ownList.count))) LIMIT 1
                    """, args: args)
                if later != nil { continue }
            }
            let recipients = try db.all("SELECT status, last_open_at FROM tracked_recipients WHERE tracked_id = ?", t["id"] as Int)
            out[threadId] = ReceiptStatusLogic.summarize(recipients.map { (ReceiptStatus(rawValue: $0["status"]) ?? .sent, $0["last_open_at"]) })
        }
        return out
    }
}

extension GRDBStore: ReceiptsRepository {
    public func createTracked(_ input: NewTracked) async throws -> Int {
        try await write { db in try ReceiptsSQL.createTracked(db, input) }
    }

    public func linkSentMessage(accountId: AccountID, ref: String?, messageId: String, threadId: ThreadID) async throws {
        try await write { db in try ReceiptsSQL.linkSent(db, accountId: accountId, ref: ref, messageId: messageId, threadId: threadId) }
    }

    /// Changes the tracking state and re-derives every recipient's status and note under it (a stopped or unregistered message is
    /// not registered with the service, so its recipients without opens or replies become untracked).
    public func setTrackedState(_ trackedId: Int, _ state: NewTracked.State) async throws {
        let now = clock()
        try await write { db in
            try db.run("UPDATE tracked_messages SET state = ? WHERE id = ?", state.rawValue, trackedId)
            if state == .unregistered {
                try db.run("UPDATE tracked_recipients SET status = 'untracked' WHERE tracked_id = ? AND status = 'sent'", trackedId)
            }
            for r in try db.all("SELECT id FROM tracked_recipients WHERE tracked_id = ? ORDER BY id", trackedId) {
                _ = try ReceiptsSQL.recompute(db, recipientId: r["id"], now: now)
            }
        }
    }

    public func findTracked(ref: String) async throws -> Int? {
        try await read { db in try Int.fetchOne(db, sql: "SELECT id FROM tracked_messages WHERE ref = ?", arguments: [ref]) }
    }

    public func findTracked(accountId: AccountID, messageId: String) async throws -> Int? {
        try await read { db in
            try Int.fetchOne(db, sql: "SELECT id FROM tracked_messages WHERE account_id = ? AND message_id = ?", arguments: [accountId, messageId])
        }
    }

    /// Tracked messages the poller should still ask the service about.
    public func listPollable(sinceMs: EpochMs) async throws -> [PollableTracked] {
        try await read { db in
            try db.all("SELECT id, ref, sent_at FROM tracked_messages WHERE state = 'active' AND sent_at >= ? ORDER BY sent_at DESC", sinceMs)
                .map { PollableTracked(trackedId: $0["id"], ref: $0["ref"], sentAt: $0["sent_at"]) }
        }
    }

    public func tracked(id: Int) async throws -> TrackedMessage? {
        try await read { db in try ReceiptsSQL.tracked(db, id: id) }
    }

    /// `unopenedOnly`: nil lists all, true lists mail nobody opened, false lists mail somebody opened or replied to.
    public func listTracked(limit: Int?, unopenedOnly: Bool?) async throws -> [TrackedMessage] {
        try await read { db in try ReceiptsSQL.list(db, limit: limit, unopenedOnly: unopenedOnly) }
    }

    public func receiptDetail(trackedId: Int) async throws -> ReceiptDetail {
        try await read { db in try ReceiptsSQL.detail(db, trackedId: trackedId) }
    }

    public func receiptDetail(accountId: AccountID, messageId: String) async throws -> ReceiptDetail? {
        try await read { db in
            guard let id = try Int.fetchOne(db, sql: "SELECT id FROM tracked_messages WHERE account_id = ? AND message_id = ?", arguments: [accountId, messageId])
            else { return nil }
            return try ReceiptsSQL.detail(db, trackedId: id)
        }
    }

    /// Stores events from the receipts service (deduplicated by remote id) and recomputes affected recipients.
    public func ingestReceiptEvents(_ events: [ReceiptEventInput], now: EpochMs) async throws -> [ReceiptChange] {
        try await write { db in try ReceiptsSQL.ingest(db, events, now: now) }
    }

    public func recomputeReceipts(threadId: ThreadID, now: EpochMs) async throws -> [ReceiptChange] {
        try await write { db in try ReceiptsSQL.recompute(db, threadId: threadId, now: now) }
    }
}
