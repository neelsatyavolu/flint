// The durable outbox. Ported from store/pendingOps.ts.

import FlintModel
import Foundation
import GRDB

extension GRDBStore: PendingOpsRepository {
    public func addPendingOp(accountId: AccountID, _ op: PendingOpSpec, messageIds: [MessageRowID], now: EpochMs) async throws -> Int {
        let arg: String? = switch op.arg {
        case .flag(let b): b ? "true" : "false"
        case .folder(let id): String(id)
        case nil: nil
        }
        let ids = JSONColumn.encode(messageIds)
        return try await write { db in
            try db.insert(
                "INSERT INTO pending_ops (account_id, kind, arg, message_ids, created_at) VALUES (?,?,?,?,?)",
                accountId, op.kind.rawValue, arg, ids, now)
        }
    }

    public func removePendingOp(_ id: Int) async throws {
        try await write { db in try db.run("DELETE FROM pending_ops WHERE id = ?", id) }
    }

    /// Records a failed replay and returns the attempts so far.
    public func bumpPendingOp(_ id: Int, error: String) async throws -> Int {
        let message = String(error.prefix(300))
        return try await write { db in
            try db.run("UPDATE pending_ops SET attempts = attempts + 1, last_error = ? WHERE id = ?", message, id)
            return try Int.fetchOne(db, sql: "SELECT attempts FROM pending_ops WHERE id = ?", arguments: [id]) ?? 0
        }
    }

    public func listPendingOps() async throws -> [PendingOp] {
        try await read { db in
            try db.all("SELECT * FROM pending_ops ORDER BY id").compactMap { r in
                guard let kind = PendingKind(rawValue: r["kind"]) else { return nil }
                let arg: PendingOpSpec.Arg? = switch JSONColumn.decode(r["arg"], fallback: JSONValue.null) {
                case .bool(let b): .flag(b)
                case .number(let n): .folder(Int(n))
                default: nil
                }
                return PendingOp(
                    id: r["id"], accountId: r["account_id"], spec: PendingOpSpec(kind: kind, arg: arg),
                    messageIds: JSONColumn.decode(r["message_ids"], fallback: [Int]()), createdAt: r["created_at"], attempts: r["attempts"])
            }
        }
    }
}
