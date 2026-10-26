// ThreadQuery to ThreadPage: keyset-paged thread lists for every view, bundles for the focused inbox, and hydration of list
// items. Ported from store/threadList.ts.

import FlintModel
import Foundation
import GRDB

enum ThreadListSQL {
    static let defaultLimit = 50
    static let maxLimit = 200
    private static let draftsScanLimit = 100_000
    /// Sort key of a thread: its newest message, or when it last resurfaced.
    private static let key = "MAX(MAX(m.date), COALESCE(t.resurfaced_at, 0))"

    struct Where {
        var sql: String
        var params: [SQLArg]
    }

    private struct PageRow {
        var id: Int
        var key: Int
    }

    // MARK: Cursors

    static func encodeCursor(key: Int, id: Int) -> String {
        let data = Data("[\(key),\(id)]".utf8)
        return data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    static func decodeCursor(_ cursor: String) throws -> (key: Int, id: Int) {
        var b64 = cursor.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b64.count % 4 != 0 { b64.append("=") }
        if let data = Data(base64Encoded: b64), let v = try? JSONDecoder().decode([Int].self, from: data), v.count == 2 { return (v[0], v[1]) }
        throw FlintError(.invalid, "That page marker is no longer valid. Reload the list.")
    }

    // MARK: Listing

    static func list(_ db: Database, _ query: ThreadQuery, now: EpochMs) throws -> ThreadPage {
        let limit = max(1, min(query.limit, maxLimit))
        if query.view == .drafts { return try listDrafts(db, query, limit: limit, now: now) }
        guard let filter = try buildWhere(db, query, now: now) else { return ThreadPage(items: []) }
        do {
            let rows = try pageRows(db, filter, query, limit: limit)
            let page = Array(rows.prefix(limit))
            let items = try hydrate(db, page.map(\.id), filter)
            let bundles = query.focused && query.view == .inbox && query.category == nil ? try bundles(db, query, now: now) : []
            let next = rows.count > limit ? page.last.map { encodeCursor(key: $0.key, id: $0.id) } : nil
            return ThreadPage(items: items, bundles: bundles, nextCursor: next)
        } catch let e as DatabaseError where query.view == .search {
            _ = e
            return ThreadPage(items: [])
        }
    }

    /// List items for specific threads. Counts and snippets cover messages outside trash and spam. Input order is kept.
    static func items(_ db: Database, _ ids: [ThreadID]) throws -> [ThreadListItem] {
        if ids.isEmpty { return [] }
        let filter = Where(sql: "NOT \(SearchSQL.roleMember("trash")) AND NOT \(SearchSQL.roleMember("spam"))", params: [])
        let byId = Dictionary(try hydrate(db, ids, filter).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        return ids.compactMap { byId[$0] }
    }

    // MARK: Drafts view

    /// Every local draft plus the server Drafts copies no local draft stands behind, newest first. Drafts are few, so both
    /// sets are read whole, merged and paged here. Local rows without a thread carry the negative id of their draft.
    private static func listDrafts(_ db: Database, _ query: ThreadQuery, limit: Int, now: EpochMs) throws -> ThreadPage {
        if query.unreadOnly { return ThreadPage(items: []) }
        var noCursor = query
        noCursor.cursor = nil
        let server = try buildWhere(db, noCursor, now: now)
        var serverRows: [PageRow] = []
        var serverItems: [Int: ThreadListItem] = [:]
        if let server {
            var scan = noCursor
            scan.unreadOnly = false
            serverRows = try pageRows(db, server, scan, limit: draftsScanLimit)
            for item in try hydrate(db, serverRows.map(\.id), server) { serverItems[item.id] = try withServerDraft(db, item, server) }
        }
        let hidden: Set<String> = query.accountId != nil ? [] : Set(try AccountsSQL.list(db).filter { !$0.showInUnified }.map(\.id))
        var entries = try DraftList.localEntries(db, accountId: query.accountId).filter { !hidden.contains($0.item.accountId) }
        for r in serverRows { if let item = serverItems[r.id] { entries.append(DraftList.Entry(key: r.key, id: r.id, item: item)) } }
        let asc = query.sort == .oldest
        entries.sort { a, b in asc ? (a.key, a.id) < (b.key, b.id) : (a.key, a.id) > (b.key, b.id) }
        var rest = entries
        if let c = query.cursor {
            let after = try decodeCursor(c)
            rest = entries.filter { e in asc ? (e.key, e.id) > (after.key, after.id) : (e.key, e.id) < (after.key, after.id) }
        }
        let shown = Array(rest.prefix(limit))
        let next = rest.count > limit ? shown.last.map { encodeCursor(key: $0.key, id: $0.id) } : nil
        return ThreadPage(items: shown.map(\.item), nextCursor: next)
    }

    /// A server draft row lists its recipients and names the message to open.
    private static func withServerDraft(_ db: Database, _ item: ThreadListItem, _ filter: Where) throws -> ThreadListItem {
        let args: [SQLArg] = [item.id] + filter.params
        guard let m = try db.first(
            """
            SELECT m.id, m.to_json, m.cc_json FROM messages m JOIN threads t ON t.id = m.thread_id
            WHERE m.thread_id = ? AND \(filter.sql) ORDER BY m.date DESC, m.id DESC LIMIT 1
            """, args: args)
        else { return item }
        var out = item
        out.participants = JSONColumn.addresses(m["to_json"]) + JSONColumn.addresses(m["cc_json"])
        out.draft = DraftRef(draftId: nil, messageId: m["id"])
        return out
    }

    // MARK: Query building

    private static func buildWhere(_ db: Database, _ query: ThreadQuery, now: EpochMs) throws -> Where? {
        let blocked = query.view == .inbox || query.view == .blocked ? try RulesSQL.blockedPatterns(db) : []
        guard let base = ThreadViews.predicate(query, now: now, blocked: blocked) else { return nil }
        var parts: [String] = [base.sql]
        var params: [SQLArg] = base.params.map(\.dbValue)
        if query.view == .search {
            let parsed = SearchParser.parse(query.search ?? "")
            if SearchSQL.isEmpty(parsed) { return nil }
            let s = SearchSQL.buildWhere(parsed, now: now)
            parts.append(s.sql)
            params += s.params.map(\.dbValue)
            if s.excludeTrashSpam { parts.append("NOT \(SearchSQL.roleMember("trash")) AND NOT \(SearchSQL.roleMember("spam"))") }
        }
        if let account = query.accountId {
            parts.append("m.account_id = ?")
            params.append(account)
        } else if query.view != .folder && query.view != .blocked {
            parts.append(inUnified("m.account_id"))
        }
        if let cat = ThreadViews.category(query) {
            parts.append("t.category = ?")
            params.append(cat.rawValue)
        }
        return Where(sql: parts.map { "(\($0))" }.joined(separator: " AND "), params: params)
    }

    private static func pageRows(_ db: Database, _ filter: Where, _ query: ThreadQuery, limit: Int) throws -> [PageRow] {
        let asc = query.sort == .oldest
        var having: [String] = []
        var params = filter.params
        if query.unreadOnly { having.append("SUM(m.seen = 0 AND m.draft = 0) > 0") }
        if query.hasAttachments { having.append("SUM(m.has_attachments) > 0") }
        if let c = query.cursor {
            let (k, id) = try decodeCursor(c)
            let cmp = asc ? ">" : "<"
            having.append("(\(key) \(cmp) ? OR (\(key) = ? AND t.id \(cmp) ?))")
            params += [k, k, id]
        }
        let dir = asc ? "ASC" : "DESC"
        params.append(limit + 1)
        return try db.all(
            """
            SELECT t.id AS id, \(key) AS k FROM messages m JOIN threads t ON t.id = m.thread_id
            WHERE \(filter.sql) GROUP BY t.id \(having.isEmpty ? "" : "HAVING \(having.joined(separator: " AND "))")
            ORDER BY k \(dir), t.id \(dir) LIMIT ?
            """, args: params
        ).map { PageRow(id: $0["id"], key: $0["k"]) }
    }

    // MARK: Hydration

    private struct MsgRow {
        var from: [Address], date: Int, seen: Bool, draft: Bool, hasAttachments: Bool, snippet: String
    }

    private static func hydrate(_ db: Database, _ ids: [ThreadID], _ filter: Where) throws -> [ThreadListItem] {
        if ids.isEmpty { return [] }
        let marks = SQL.marks(ids.count)
        let idArgs: [SQLArg] = ids
        var threads: [Int: Row] = [:]
        for t in try db.all("SELECT * FROM threads WHERE id IN (\(marks))", args: idArgs) { threads[t["id"]] = t }
        var byThread: [Int: [MsgRow]] = [:]
        for m in try db.all(
            """
            SELECT m.thread_id, m.from_json, m.date, m.seen, m.draft, m.has_attachments, m.snippet
            FROM messages m JOIN threads t ON t.id = m.thread_id
            WHERE m.thread_id IN (\(marks)) AND \(filter.sql) ORDER BY m.thread_id, m.date, m.id
            """, args: idArgs + filter.params
        ) {
            byThread[m["thread_id"] as Int, default: []].append(MsgRow(
                from: JSONColumn.addresses(m["from_json"]), date: m["date"], seen: m.bool("seen"), draft: m.bool("draft"),
                hasAttachments: m.bool("has_attachments"), snippet: m["snippet"]))
        }
        var drafts = Set(try db.all("SELECT DISTINCT thread_id FROM drafts WHERE thread_id IN (\(marks)) AND \(MessagesSQL.notQueuedDraft)", args: idArgs).map { $0["thread_id"] as Int })
        drafts.formUnion(try db.all("SELECT DISTINCT thread_id FROM messages WHERE thread_id IN (\(marks)) AND draft = 1", args: idArgs).map { $0["thread_id"] as Int })
        let own = try AccountsSQL.ownAddresses(db)
        let receipts = try ReceiptsSQL.summaries(db, threadIds: ids, own: own)
        var items: [ThreadListItem] = []
        for id in ids {
            guard let t = threads[id], let all = byThread[id], !all.isEmpty else { continue }
            // Server drafts are not part of the conversation: hide them unless the thread has nothing else in this view.
            let list = all.contains { !$0.draft } ? all.filter { !$0.draft } : all
            let latest = list[list.count - 1]
            items.append(ThreadListItem(
                id: id, accountId: t["account_id"], subject: t["subject"], snippet: latest.snippet,
                participants: participants(list.map(\.from), own: own), lastDate: max(latest.date, t["resurfaced_at"] ?? 0),
                messageCount: list.count, unreadCount: list.filter { !$0.seen && !$0.draft }.count,
                hasAttachments: list.contains { $0.hasAttachments }, pinned: t.bool("pinned"), muted: t.bool("muted"),
                snoozedUntil: t["snoozed_until"], category: asCategory(t["category"]) ?? .people, hasDraft: drafts.contains(id), receipt: receipts[id]))
        }
        return items
    }

    /// Distinct senders in message order, most recent last. The user's own addresses show as "me".
    static func participants(_ senders: [[Address]], own: Set<String>) -> [Address] {
        var order: [String] = []
        var seen: [String: Address] = [:]
        for from in senders {
            guard let a = from.first else { continue }
            let key = lowerAddress(a)
            order.removeAll { $0 == key }
            order.append(key)
            seen[key] = own.contains(key) ? Address(name: "me", address: a.address) : a
        }
        return order.compactMap { seen[$0] }
    }

    // MARK: Bundles

    private static func bundles(_ db: Database, _ query: ThreadQuery, now: EpochMs) throws -> [InboxBundle] {
        var q = query
        q.focused = false
        q.category = nil
        q.cursor = nil
        q.unreadOnly = false
        guard let filter = try buildWhere(db, q, now: now) else { return [] }
        let rows = try db.all(
            """
            SELECT t.id AS id, t.category AS category, \(key) AS k, SUM(m.seen = 0 AND m.draft = 0) AS unread
            FROM messages m JOIN threads t ON t.id = m.thread_id
            WHERE \(filter.sql) AND t.category <> 'people' GROUP BY t.id ORDER BY k DESC, t.id DESC
            """, args: filter.params)
        var out: [InboxBundle] = []
        for category in [MailCategory.notifications, .newsletters] {
            let mine = rows.filter { ($0["category"] as String) == category.rawValue }
            guard let first = mine.first else { continue }
            out.append(InboxBundle(
                category: category, unreadCount: mine.filter { ($0["unread"] as Int? ?? 0) > 0 }.count, totalCount: mine.count,
                lastDate: first["k"], latest: try mine.prefix(3).map { try latestOf(db, $0["id"], filter) }))
        }
        return out
    }

    private static func latestOf(_ db: Database, _ threadId: ThreadID, _ filter: Where) throws -> BundleSample {
        let args: [SQLArg] = [threadId] + filter.params
        let r = try db.first(
            """
            SELECT m.from_json, m.subject FROM messages m JOIN threads t ON t.id = m.thread_id
            WHERE m.thread_id = ? AND \(filter.sql) ORDER BY m.date DESC, m.id DESC LIMIT 1
            """, args: args)
        return BundleSample(from: JSONColumn.addresses(r?["from_json"]).first ?? Address(name: "", address: ""), subject: r?["subject"] ?? "")
    }
}

// `ThreadsRepository` conformance is declared in StoreConformance.swift; its methods live in this file, ThreadActions.swift,
// Recategorize.swift and Sidebar.swift.
extension GRDBStore {
    /// ThreadQuery to ThreadPage. Search input that cannot be parsed or run yields an empty page, never an error.
    public func listThreads(_ query: ThreadQuery, now: EpochMs) async throws -> ThreadPage {
        try await read { db in try ThreadListSQL.list(db, query, now: now) }
    }

    public func threadItems(_ ids: [ThreadID]) async throws -> [ThreadListItem] {
        try await read { db in try ThreadListSQL.items(db, ids) }
    }
}
