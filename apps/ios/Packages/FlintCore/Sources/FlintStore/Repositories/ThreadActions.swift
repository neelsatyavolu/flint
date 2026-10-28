// Local (optimistic) thread state changes. Each returns an undo snapshot and the locations of messages the mail engine must
// update on the server. Ported from store/threadActions.ts.

import FlintModel
import Foundation
import GRDB

enum ThreadActionsSQL {
    struct MsgState {
        var id: Int, threadId: Int, accountId: String, seen: Bool, flagged: Bool, answered: Bool, draft: Bool
        var folderId: Int, uid: Int, category: String?, categorySource: String?

        init(_ r: Row) {
            id = r["id"]; threadId = r["thread_id"]; accountId = r["account_id"]; seen = r.bool("seen"); flagged = r.bool("flagged")
            answered = r.bool("answered"); draft = r.bool("draft"); folderId = r["folder_id"]; uid = r["uid"]
            category = r["category"]; categorySource = r["category_source"]
        }
    }

    static let stateColumns = "id, thread_id, account_id, seen, flagged, answered, draft, folder_id, uid, category, category_source"

    static func members(_ db: Database, _ messageIds: [Int]) throws -> [Int: [Int]] {
        var out: [Int: [Int]] = [:]
        for part in messageIds.chunked() {
            let args: [SQLArg] = part
            for r in try db.all("SELECT message_id, folder_id FROM message_folders WHERE message_id IN (\(SQL.marks(part.count))) ORDER BY folder_id", args: args) {
                out[r["message_id"] as Int, default: []].append(r["folder_id"])
            }
        }
        return out
    }

    static func snapshot(_ db: Database, _ threadIds: [ThreadID]) throws -> ThreadSnapshot {
        var threads: [ThreadSnapshot.Thread] = []
        for part in threadIds.chunked() {
            let args: [SQLArg] = part
            let marks = SQL.marks(part.count)
            let rows = try db.all("SELECT id, pinned, muted, snoozed_until, resurfaced_at FROM threads WHERE id IN (\(marks))", args: args)
            let msgs = try db.all("SELECT \(stateColumns) FROM messages WHERE thread_id IN (\(marks)) ORDER BY id", args: args).map(MsgState.init)
            let members = try members(db, msgs.map(\.id))
            for t in rows {
                let id: Int = t["id"]
                threads.append(ThreadSnapshot.Thread(
                    id: id, pinned: t.bool("pinned"), muted: t.bool("muted"), snoozedUntil: t["snoozed_until"], resurfacedAt: t["resurfaced_at"],
                    messages: msgs.filter { $0.threadId == id }.map {
                        ThreadSnapshot.Message(
                            id: $0.id, folderId: $0.folderId, uid: $0.uid, seen: $0.seen, flagged: $0.flagged, answered: $0.answered,
                            memberFolderIds: members[$0.id] ?? [], category: $0.category, categorySource: $0.categorySource)
                    }))
            }
        }
        return ThreadSnapshot(version: 1, threads: threads)
    }

    /// Puts thread state, flags and folder membership back. Server UIDs are not touched: if the engine already moved mail on the
    /// server it runs the inverse operation using the snapshot's folderId and uid.
    static func restore(_ db: Database, _ snapshot: ThreadSnapshot) throws -> [ThreadID] {
        var restored: [ThreadID] = []
        for t in snapshot.threads {
            guard try db.exists("SELECT 1 FROM threads WHERE id = ?", t.id) else { continue }
            try db.run("UPDATE threads SET pinned = ?, muted = ?, snoozed_until = ?, resurfaced_at = ? WHERE id = ?", t.pinned, t.muted, t.snoozedUntil, t.resurfacedAt, t.id)
            for m in t.messages {
                guard try db.exists("SELECT 1 FROM messages WHERE id = ?", m.id) else { continue }
                try db.run("UPDATE messages SET seen = ?, flagged = ?, answered = ?, category = ?, category_source = ? WHERE id = ?", m.seen, m.flagged, m.answered, m.category, m.categorySource, m.id)
                try db.run("DELETE FROM message_folders WHERE message_id = ?", m.id)
                for f in m.memberFolderIds {
                    try db.run("INSERT OR IGNORE INTO message_folders (message_id, folder_id) SELECT ?, id FROM folders WHERE id = ?", m.id, f)
                }
            }
            restored.append(t.id)
        }
        try Rollup.recomputeThreads(db, restored)
        return restored
    }

    /// Snapshot, change, recompute, then report the changed messages' server locations.
    static func apply(_ db: Database, _ threadIds: [ThreadID], _ change: ([MsgState]) throws -> [MessageRowID]) throws -> ActionResult {
        var seen = Set<ThreadID>()
        let ids = threadIds.filter { seen.insert($0).inserted }
        let snap = try snapshot(db, ids)
        var msgs: [MsgState] = []
        for part in ids.chunked() {
            let args: [SQLArg] = part
            msgs += try db.all("SELECT \(stateColumns) FROM messages WHERE thread_id IN (\(SQL.marks(part.count))) ORDER BY date, id", args: args).map(MsgState.init)
        }
        let changed = try change(msgs)
        try Rollup.recomputeThreads(db, ids)
        return ActionResult(snapshot: snap, locations: try MessagesSQL.locations(db, column: "m.id", ids: changed))
    }

    static func setColumn(_ db: Database, _ column: String, _ value: Bool, _ ids: [Int]) throws {
        for part in ids.chunked() {
            try db.run("UPDATE messages SET \(column) = ? WHERE id IN (\(SQL.marks(part.count)))", args: [value] + part.map { $0 as SQLArg })
        }
    }

    static func updateThreads(_ db: Database, _ set: String, _ args: [SQLArg], _ threadIds: [ThreadID]) throws {
        for part in threadIds.chunked() {
            try db.run("UPDATE threads SET \(set) WHERE id IN (\(SQL.marks(part.count)))", args: args + part.map { $0 as SQLArg })
        }
    }
}

extension GRDBStore {
    public func snapshotThreads(_ threadIds: [ThreadID]) async throws -> ThreadSnapshot {
        try await read { db in try ThreadActionsSQL.snapshot(db, threadIds) }
    }

    public func restoreSnapshot(_ snapshot: ThreadSnapshot) async throws -> [ThreadID] {
        try await write { db in try ThreadActionsSQL.restore(db, snapshot) }
    }

    public func markRead(_ threadIds: [ThreadID], read: Bool) async throws -> ActionResult {
        try await write { db in
            try ThreadActionsSQL.apply(db, threadIds) { msgs in
                let changed = msgs.filter { !$0.draft && $0.seen != read }.map(\.id)
                try ThreadActionsSQL.setColumn(db, "seen", read, changed)
                return changed
            }
        }
    }

    /// Pins or unpins the thread and flags (or unflags) its messages, mirroring \Flagged on the server.
    public func setPinned(_ threadIds: [ThreadID], pinned: Bool) async throws -> ActionResult {
        try await write { db in
            try ThreadActionsSQL.apply(db, threadIds) { msgs in
                let changed = msgs.filter { !$0.draft && $0.flagged != pinned }.map(\.id)
                try ThreadActionsSQL.setColumn(db, "flagged", pinned, changed)
                try ThreadActionsSQL.updateThreads(db, "pinned = ?", [pinned], threadIds)
                return changed
            }
        }
    }

    public func setMuted(_ threadIds: [ThreadID], muted: Bool) async throws -> ActionResult {
        try await write { db in
            try ThreadActionsSQL.apply(db, threadIds) { _ in
                try ThreadActionsSQL.updateThreads(db, "muted = ?", [muted], threadIds)
                return []
            }
        }
    }

    public func snooze(_ threadIds: [ThreadID], until: EpochMs) async throws -> ActionResult {
        try await write { db in
            try ThreadActionsSQL.apply(db, threadIds) { _ in
                try ThreadActionsSQL.updateThreads(db, "snoozed_until = ?, resurfaced_at = NULL", [until], threadIds)
                return []
            }
        }
    }

    public func unsnooze(_ threadIds: [ThreadID]) async throws -> ActionResult {
        try await write { db in
            try ThreadActionsSQL.apply(db, threadIds) { _ in
                try ThreadActionsSQL.updateThreads(db, "snoozed_until = NULL", [], threadIds)
                return []
            }
        }
    }

    /// Threads whose snooze has expired.
    public func listDueSnoozes(now: EpochMs) async throws -> [ThreadID] {
        try await read { db in
            try db.all("SELECT id FROM threads WHERE snoozed_until IS NOT NULL AND snoozed_until <= ? ORDER BY snoozed_until", now).map { $0["id"] as Int }
        }
    }

    /// Snooze fired: clears it, sets resurfaced_at, and marks the latest message unread (returned in locations).
    public func wakeSnoozed(_ threadId: ThreadID, now: EpochMs) async throws -> ActionResult {
        try await write { db in
            try ThreadActionsSQL.apply(db, [threadId]) { msgs in
                try db.run("UPDATE threads SET snoozed_until = NULL, resurfaced_at = ? WHERE id = ?", now, threadId)
                guard let latest = msgs.filter({ !$0.draft }).max(by: { $0.id < $1.id }), latest.seen else { return [] }
                try ThreadActionsSQL.setColumn(db, "seen", false, [latest.id])
                return [latest.id]
            }
        }
    }

    /// Reminder fired: sorts the thread to the top again without changing flags.
    public func resurface(_ threadId: ThreadID, now: EpochMs) async throws {
        try await write { db in try db.run("UPDATE threads SET resurfaced_at = ? WHERE id = ?", now, threadId) }
    }

    /// After the engine moved a message on the server: records its new folder and UID so a later sync does not duplicate it.
    public func relocateMessage(_ messageRowId: MessageRowID, folderId: FolderID, uid: Int) async throws {
        try await write { db in
            if let clash = try Int.fetchOne(db, sql: "SELECT id FROM messages WHERE folder_id = ? AND uid = ? AND id <> ?", arguments: [folderId, uid, messageRowId]) {
                try db.run("DELETE FROM messages_fts WHERE rowid = ?", clash)
                try db.run("DELETE FROM messages WHERE id = ?", clash)
            }
            try db.run("UPDATE messages SET folder_id = ?, uid = ? WHERE id = ?", folderId, uid, messageRowId)
            try db.run("INSERT OR IGNORE INTO message_folders (message_id, folder_id) VALUES (?,?)", messageRowId, folderId)
        }
    }
}
