// SPEC section 4 thread key resolution, including subject fallback and merging of threads a new message links together.
// Ported from store/threadResolve.ts.

import FlintModel
import Foundation
import GRDB

enum ThreadResolve {
    struct Resolved {
        var threadId: ThreadID
        var mergedThreadIds: [ThreadID]
    }

    private static func getOrCreate(_ db: Database, _ accountId: AccountID, key: String, subject: String, date: EpochMs) throws -> ThreadID {
        if let id = try Int.fetchOne(db, sql: "SELECT id FROM threads WHERE account_id = ? AND thread_key = ?", arguments: [accountId, key]) { return id }
        return try db.insert("INSERT INTO threads (account_id, thread_key, subject, last_date) VALUES (?,?,?,?)", accountId, key, subject, date)
    }

    private static func findLinked(_ db: Database, _ accountId: AccountID, key: String?, ownId: String?, linked: [String]) throws -> Set<ThreadID> {
        var found = Set<ThreadID>()
        var keys: [String] = key.map { [$0] } ?? []
        keys += (linked + (ownId.map { [$0] } ?? [])).map { "mid:\($0)" }
        var unique = Set<String>()
        keys = keys.filter { unique.insert($0).inserted }
        for part in keys.chunked(200) {
            let args: [SQLArg] = [accountId] + part
            for r in try db.all("SELECT id FROM threads WHERE account_id = ? AND thread_key IN (\(SQL.marks(part.count)))", args: args) { found.insert(r["id"]) }
        }
        for part in linked.chunked(200) {
            let args: [SQLArg] = [accountId] + part
            for r in try db.all("SELECT DISTINCT thread_id FROM messages WHERE account_id = ? AND message_id IN (\(SQL.marks(part.count)))", args: args) { found.insert(r["thread_id"]) }
        }
        if let ownId {
            for r in try db.all("SELECT DISTINCT thread_id FROM messages WHERE account_id = ? AND in_reply_to = ?", accountId, ownId) { found.insert(r["thread_id"]) }
        }
        return found
    }

    private static func findBySubject(_ db: Database, _ accountId: AccountID, _ msg: IngestMessage, own: Set<String>) throws -> ThreadID? {
        if Threading.isGenericSubject(msg.subject) || Threading.isAutomatedHeaders(msg.headers) { return nil }
        let core = Threading.joinSubject(msg.subject)
        if core.isEmpty { return nil }
        func others(_ lists: [Address]...) -> Set<String> {
            Set(lists.flatMap { $0 }.map { $0.address.lowercased() }.filter { !$0.isEmpty && !own.contains($0) })
        }
        let mine = others(msg.from, msg.to, msg.cc)
        let rows = try db.all(
            """
            SELECT thread_id, subject, from_json, to_json, cc_json, headers_json FROM messages
            WHERE account_id = ? AND draft = 0 AND date BETWEEN ? AND ? AND subject LIKE ? ESCAPE '\\' ORDER BY date DESC LIMIT 200
            """,
            accountId, msg.date - Threading.subjectJoinWindowMs, msg.date + Threading.subjectJoinWindowMs, "%\(SQL.escapeLike(core))%")
        for r in rows {
            if Threading.joinSubject(r["subject"]) != core { continue }
            if Threading.isAutomatedHeaders(JSONColumn.decode(r["headers_json"], fallback: [String: String]())) { continue }
            let theirs = others(JSONColumn.addresses(r["from_json"]), JSONColumn.addresses(r["to_json"]), JSONColumn.addresses(r["cc_json"]))
            if Threading.sharesParticipant(mine, theirs) { return r["thread_id"] }
        }
        return nil
    }

    /// Moves everything from `others` into `primary`, carrying pin, mute and snooze state, then deletes the empty threads.
    static func merge(_ db: Database, primary: ThreadID, others: [ThreadID]) throws {
        if others.isEmpty { return }
        let marks = SQL.marks(others.count)
        let otherArgs: [SQLArg] = others
        let state = try db.all("SELECT muted, snoozed_until, resurfaced_at FROM threads WHERE id IN (\(marks))", args: otherArgs)
        for table in ["messages", "drafts", "reminders", "tracked_messages"] {
            try db.run("UPDATE \(table) SET thread_id = ? WHERE thread_id IN (\(marks))", args: [primary] + otherArgs)
        }
        func later(_ a: Int?, _ b: Int?) -> Int? { a.flatMap { x in b.map { max(x, $0) } ?? x } ?? b }
        guard let cur = try db.first("SELECT muted, snoozed_until, resurfaced_at FROM threads WHERE id = ?", primary) else { return }
        let muted = cur.bool("muted") || state.contains { $0.bool("muted") }
        let snoozed = state.reduce(cur["snoozed_until"] as Int?) { later($0, $1["snoozed_until"]) }
        let resurfaced = state.reduce(cur["resurfaced_at"] as Int?) { later($0, $1["resurfaced_at"]) }
        try db.run("UPDATE threads SET muted = ?, snoozed_until = ?, resurfaced_at = ? WHERE id = ?", muted, snoozed, resurfaced, primary)
        try db.run("DELETE FROM threads WHERE id IN (\(marks))", args: otherArgs)
    }

    static func resolve(_ db: Database, accountId: AccountID, folderId: FolderID, msg: IngestMessage, own: Set<String>) throws -> Resolved {
        let input = ThreadingInput(gmThrid: msg.gmThrid, messageId: cleanID(msg.messageId), inReplyTo: cleanID(msg.inReplyTo), references: msg.references)
        let key = Threading.threadKey(for: input)
        if let g = input.gmThrid, !g.isEmpty, let key {
            return Resolved(threadId: try getOrCreate(db, accountId, key: key, subject: msg.subject, date: msg.date), mergedThreadIds: [])
        }
        var found = try findLinked(db, accountId, key: key, ownId: input.messageId, linked: Threading.linkedIDs(input))
        if found.isEmpty && !Threading.hasParentLink(input), let bySubject = try findBySubject(db, accountId, msg, own: own) {
            found.insert(bySubject)
        }
        if found.isEmpty {
            let threadKey = key ?? "local:\(folderId):\(msg.uid)"
            return Resolved(threadId: try getOrCreate(db, accountId, key: threadKey, subject: msg.subject, date: msg.date), mergedThreadIds: [])
        }
        let ids = found.sorted()
        var keyed: Int?
        if let key { keyed = try Int.fetchOne(db, sql: "SELECT id FROM threads WHERE account_id = ? AND thread_key = ?", arguments: [accountId, key]) }
        let primary = keyed.flatMap { found.contains($0) ? $0 : nil } ?? ids[0]
        let others = ids.filter { $0 != primary }
        try merge(db, primary: primary, others: others)
        return Resolved(threadId: primary, mergedThreadIds: others)
    }
}
