// Re-running the categorizer, pinning a category, and refreshing stored headers. Ported from store/recategorize.ts.

import FlintModel
import Foundation
import GRDB

extension GRDBStore {
    /// Sets the category of every received message in these threads and records who decided it, so a later `recategorizeAll`
    /// keeps it. Used by the rule "category" action and by manual changes.
    public func pinCategory(_ threadIds: [ThreadID], _ category: MailCategory, source: CategorySource) async throws {
        try await write { db in
            for part in threadIds.chunked() {
                let args: [SQLArg] = [category.rawValue, source.rawValue] + part
                try db.run("UPDATE messages SET category = ?, category_source = ? WHERE draft = 0 AND thread_id IN (\(SQL.marks(part.count)))", args: args)
            }
            try Rollup.recomputeThreads(db, threadIds)
        }
    }

    /// Re-runs the categorizer over stored received mail (headers, sender, subject, contact history) and rewrites category where
    /// it changed, then recomputes the threads touched. Own sent mail, drafts and mail whose category a rule or the user set keep
    /// their value. Returns how many messages changed.
    public func recategorizeAll() async throws -> Int {
        let classifier = self.classifier
        return try await write { db in
            let own = try AccountsSQL.ownAddresses(db)
            let known = Set(try String.fetchAll(db, sql: "SELECT email FROM contacts WHERE sent_count > 0"))
            var touched = Set<ThreadID>()
            var changed = 0
            for r in try db.all("SELECT id, thread_id, subject, from_json, headers_json, category FROM messages WHERE draft = 0 AND category_source IS NULL") {
                let from = JSONColumn.addresses(r["from_json"]).first
                let address = (from?.address ?? "").lowercased()
                if own.contains(address) { continue }
                let next = classifier.category(
                    from: from, headers: JSONColumn.decode(r["headers_json"], fallback: [String: String]()),
                    isKnownContact: known.contains(address), subject: r["subject"])
                let stored: String? = r["category"]
                if stored != nil && next == (asCategory(stored) ?? .people) { continue }
                try db.run("UPDATE messages SET category = ? WHERE id = ?", next.rawValue, r["id"] as Int)
                touched.insert(r["thread_id"])
                changed += 1
            }
            try Rollup.recomputeThreads(db, touched.sorted())
            return changed
        }
    }

    /// Received inbox mail of an account since a date whose category nobody set on purpose, grouped by the folder its UID lives in
    /// (All Mail for Gmail). Used to re-fetch headers that older syncs did not store.
    public func headerRefreshTargets(accountId: AccountID, sinceMs: EpochMs) async throws -> [HeaderRefreshTarget] {
        try await read { db in
            let rows = try db.all(
                """
                SELECT m.folder_id, f.path, m.uid FROM messages m JOIN folders f ON f.id = m.folder_id
                WHERE m.account_id = ? AND m.draft = 0 AND m.category_source IS NULL AND m.date >= ?
                  AND EXISTS (SELECT 1 FROM message_folders mf JOIN folders fi ON fi.id = mf.folder_id WHERE mf.message_id = m.id AND fi.role = 'inbox')
                ORDER BY m.folder_id, m.uid
                """, accountId, sinceMs)
            var order: [Int] = []
            var byFolder: [Int: HeaderRefreshTarget] = [:]
            for r in rows {
                let id: Int = r["folder_id"]
                if byFolder[id] == nil {
                    byFolder[id] = HeaderRefreshTarget(folderId: id, folderPath: r["path"], uids: [])
                    order.append(id)
                }
                byFolder[id]?.uids.append(r["uid"])
            }
            return order.compactMap { byFolder[$0] }
        }
    }

    /// Adds freshly fetched headers to stored messages (new values win; nothing is removed). Returns how many rows changed.
    public func mergeHeaders(_ folderId: FolderID, _ items: [(uid: Int, headers: [String: String])]) async throws -> Int {
        try await write { db in
            var n = 0
            for item in items where !item.headers.isEmpty {
                n += try db.run("UPDATE messages SET headers_json = json_patch(headers_json, ?) WHERE folder_id = ? AND uid = ?", JSONColumn.encode(item.headers), folderId, item.uid)
            }
            return n
        }
    }
}
