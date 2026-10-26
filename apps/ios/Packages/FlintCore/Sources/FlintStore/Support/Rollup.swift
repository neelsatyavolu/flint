// Thread rollups: subject, last date, category and pin state derived from a thread's messages. Ported from store/rollup.ts.

import FlintModel
import Foundation
import GRDB

enum Rollup {
    /// Thread category from its messages: any people message makes the thread people, otherwise the latest message decides.
    static func category(_ messages: [(category: MailCategory?, date: EpochMs)]) -> MailCategory {
        if messages.isEmpty { return .people }
        if messages.contains(where: { ($0.category ?? .people) == .people }) { return .people }
        var latest = messages[0]
        for m in messages.dropFirst() where m.date >= latest.date { latest = m }
        return latest.category ?? .people
    }

    /// Recomputes subject, last_date, category and pinned from a thread's messages. Deletes the thread when it has none.
    /// Returns false when deleted.
    @discardableResult
    static func recomputeThread(_ db: Database, _ threadId: ThreadID) throws -> Bool {
        let all = try db.all("SELECT subject, date, category, flagged, draft FROM messages WHERE thread_id = ? ORDER BY date, id", threadId)
        if all.isEmpty {
            try db.run("DELETE FROM threads WHERE id = ?", threadId)
            return false
        }
        // Server drafts do not count toward the conversation's date, subject or category unless they are all there is.
        let rows = all.contains { ($0["draft"] as Int) == 0 } ? all.filter { ($0["draft"] as Int) == 0 } : all
        let category = category(rows.map { (asCategory($0["category"]), $0["date"] as Int) })
        let lastDate = rows.reduce(0) { max($0, $1["date"] as Int) }
        let pinned = rows.contains { ($0["flagged"] as Int) == 1 }
        let subject: String = rows[0]["subject"]
        try db.run("UPDATE threads SET subject = ?, last_date = ?, category = ?, pinned = ? WHERE id = ?", subject, lastDate, category.rawValue, pinned, threadId)
        return true
    }

    static func recomputeThreads(_ db: Database, _ ids: some Sequence<ThreadID>) throws {
        var seen = Set<ThreadID>()
        for id in ids where seen.insert(id).inserted { try recomputeThread(db, id) }
    }

    /// Deletes messages (and their search rows), then recomputes the threads they were in. Returns those thread ids.
    static func deleteMessages(_ db: Database, _ ids: [MessageRowID]) throws -> [ThreadID] {
        if ids.isEmpty { return [] }
        var threads: [ThreadID] = []
        var seen = Set<ThreadID>()
        for part in ids.chunked() {
            let marks = SQL.marks(part.count)
            let args: [SQLArg] = part
            for r in try db.all("SELECT DISTINCT thread_id FROM messages WHERE id IN (\(marks))", args: args) {
                let t: Int = r["thread_id"]
                if seen.insert(t).inserted { threads.append(t) }
            }
            try db.execute(sql: "DELETE FROM messages_fts WHERE rowid IN (\(marks))", arguments: StatementArguments(args))
            try db.execute(sql: "DELETE FROM messages WHERE id IN (\(marks))", arguments: StatementArguments(args))
        }
        try recomputeThreads(db, threads)
        return threads
    }

    /// Search-index row for a message. DELETE then INSERT by rowid: a column-subset UPDATE fails on a contentless-delete table.
    static func writeFTS(_ db: Database, rowid: MessageRowID, subject: String, from: [Address], to: [Address], cc: [Address], body: String) throws {
        try db.run("DELETE FROM messages_fts WHERE rowid = ?", rowid)
        try db.run(
            "INSERT INTO messages_fts (rowid, subject, from_text, to_text, body_text) VALUES (?,?,?,?,?)",
            rowid, subject, addressText(from), addressText(to + cc), body)
    }
}
