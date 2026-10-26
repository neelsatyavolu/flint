// Queued sends: the undo window, send later and retries. Ported from ScheduledRepo in store/drafts.ts.

import FlintModel
import Foundation
import GRDB

enum ScheduledSQL {
    static let select = "SELECT s.*, d.subject AS subject, d.to_json AS to_json FROM scheduled_sends s LEFT JOIN drafts d ON d.id = s.draft_id"

    static func send(_ r: Row) -> ScheduledSend {
        ScheduledSend(
            id: r["id"], draftId: r["draft_id"], subject: r["subject"] ?? "", to: JSONColumn.addresses(r["to_json"]), sendAt: r["send_at"],
            status: ScheduledSendStatus(rawValue: r["status"]) ?? .pending, error: r["error"], requestedBy: r["requested_by"],
            attempts: r["attempts"], messageId: r["message_id"], createdAt: r["created_at"])
    }

    static func get(_ db: Database, _ id: Int) throws -> ScheduledSend? {
        try db.first("\(select) WHERE s.id = ?", id).map(send)
    }

    static func require(_ db: Database, _ id: Int) throws -> ScheduledSend {
        guard let s = try get(db, id) else { throw FlintError(.notFound, "That scheduled send no longer exists.") }
        return s
    }
}

extension GRDBStore: ScheduledSendRepository {
    public func createScheduledSend(_ input: NewScheduledSend, now: EpochMs) async throws -> ScheduledSend {
        try await write { db in
            let id = try db.insert(
                "INSERT INTO scheduled_sends (draft_id, send_at, status, requested_by, created_at) VALUES (?,?,?,?,?)",
                input.draftId, input.sendAt, input.status.rawValue, input.requestedBy, now)
            return try ScheduledSQL.require(db, id)
        }
    }

    public func scheduledSend(id: Int) async throws -> ScheduledSend? {
        try await read { db in try ScheduledSQL.get(db, id) }
    }

    /// Pending sends whose time has come, oldest first.
    public func listDueScheduled(now: EpochMs) async throws -> [ScheduledSend] {
        try await read { db in
            try db.all("\(ScheduledSQL.select) WHERE s.status = 'pending' AND s.send_at <= ? ORDER BY s.send_at, s.id", now).map(ScheduledSQL.send)
        }
    }

    /// Earliest send_at among pending sends, for arming the timer.
    public func nextScheduledAt() async throws -> EpochMs? {
        try await read { db in try Int.fetchOne(db, sql: "SELECT MIN(send_at) FROM scheduled_sends WHERE status = 'pending'") }
    }

    /// What the UI shows: queued, awaiting approval, sending and failed sends.
    public func listScheduled() async throws -> [ScheduledSend] {
        try await read { db in
            try db.all("\(ScheduledSQL.select) WHERE s.status IN ('pending','awaiting_approval','sending','failed') ORDER BY s.send_at, s.id")
                .map(ScheduledSQL.send)
        }
    }

    public func openScheduledSend(draftId: Int) async throws -> ScheduledSend? {
        try await read { db in
            try db.first(
                "\(ScheduledSQL.select) WHERE s.draft_id = ? AND s.status IN ('pending','awaiting_approval','sending') ORDER BY s.id DESC LIMIT 1",
                draftId).map(ScheduledSQL.send)
        }
    }

    public func updateScheduled(_ id: Int, _ patch: ScheduledSendPatch) async throws -> ScheduledSend {
        try await write { db in
            let cur = try ScheduledSQL.require(db, id)
            try db.run(
                "UPDATE scheduled_sends SET status = ?, error = ?, attempts = ?, message_id = ?, send_at = ? WHERE id = ?",
                (patch.status ?? cur.status).rawValue, patch.error ?? cur.error, patch.attempts ?? cur.attempts,
                patch.messageId ?? cur.messageId, patch.sendAt ?? cur.sendAt, id)
            return try ScheduledSQL.require(db, id)
        }
    }
}
