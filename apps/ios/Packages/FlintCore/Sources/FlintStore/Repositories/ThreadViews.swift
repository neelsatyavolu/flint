// The messages each list view selects: predicates over aliases `m` (messages) and `t` (threads). Ported from store/threadViews.ts.

import FlintModel
import Foundation

enum ThreadViews {
    private static let addr = "lower(json_extract(m.from_json, '$[0].address'))"

    /// SQL for "sender matches a blocked pattern", or nil when nothing is blocked (so the clause costs nothing).
    static func blockedClause(_ patterns: Set<String>) -> SQLFragment? {
        if patterns.isEmpty { return nil }
        let exact = patterns.filter { !$0.hasPrefix("@") }.sorted()
        let domains = patterns.filter { $0.hasPrefix("@") }.sorted()
        var parts: [String] = []
        var params: [SearchParam] = []
        if !exact.isEmpty { parts.append("\(addr) IN (\(SQL.marks(exact.count)))"); params += exact.map { .text($0) } }
        if !domains.isEmpty {
            parts.append("substr(\(addr), instr(\(addr), '@')) IN (\(SQL.marks(domains.count)))")
            params += domains.map { .text($0) }
        }
        return SQLFragment(sql: "(\(parts.joined(separator: " OR ")))", params: params)
    }

    /// True for a server Drafts copy that a local draft stands behind (matched by Message-ID, or by UID in the Drafts folder).
    static let coveredByLocalDraft = """
    EXISTS (SELECT 1 FROM drafts xd WHERE xd.account_id = m.account_id AND (
      (xd.server_message_id IS NOT NULL AND xd.server_message_id = m.message_id)
      OR (xd.server_uid IS NOT NULL AND xd.server_uid = m.uid AND m.folder_id IN (SELECT xdf.id FROM folders xdf WHERE xdf.role = 'drafts'))))
    """

    private static var notTrashOrSpam: String { "NOT \(SearchSQL.roleMember("trash")) AND NOT \(SearchSQL.roleMember("spam"))" }

    /// Base predicate for a view, without account, category, unread or search filters. Nil when the view can never match anything.
    static func predicate(_ query: ThreadQuery, now: EpochMs, blocked: Set<String>) -> SQLFragment? {
        let blockedSQL = blockedClause(blocked)
        switch query.view {
        case .inbox:
            var parts = [SearchSQL.roleMember("inbox"), "(t.snoozed_until IS NULL OR t.snoozed_until <= ?)"]
            var params: [SearchParam] = [.int(now)]
            if let b = blockedSQL { parts.append("NOT \(b.sql)"); params += b.params }
            return SQLFragment(sql: parts.joined(separator: " AND "), params: params)
        case .sent: return SQLFragment(sql: SearchSQL.roleMember("sent"), params: [])
        case .drafts: return SQLFragment(sql: "\(SearchSQL.roleMember("drafts")) AND NOT \(coveredByLocalDraft)", params: [])
        case .trash: return SQLFragment(sql: SearchSQL.roleMember("trash"), params: [])
        case .spam: return SQLFragment(sql: SearchSQL.roleMember("spam"), params: [])
        case .archive: return SQLFragment(sql: SearchSQL.archivePredicate, params: [])
        case .pinned: return SQLFragment(sql: "t.pinned = 1 AND \(notTrashOrSpam)", params: [])
        case .snoozed:
            return SQLFragment(sql: "t.snoozed_until IS NOT NULL AND t.snoozed_until > ? AND \(notTrashOrSpam)", params: [.int(now)])
        case .folder:
            guard let id = query.folderId else { return nil }
            return SQLFragment(sql: "m.id IN (SELECT xf.message_id FROM message_folders xf WHERE xf.folder_id = ?)", params: [.int(id)])
        case .blocked:
            guard let b = blockedSQL else { return nil }
            return SQLFragment(sql: "\(SearchSQL.roleMember("trash")) AND \(b.sql)", params: b.params)
        case .search: return SQLFragment(sql: "1=1", params: [])
        }
    }

    /// Focused inbox: people threads only, or one bundle's category. Only applies to the inbox view.
    static func category(_ query: ThreadQuery) -> MailCategory? {
        guard query.view == .inbox else { return nil }
        if let c = query.category { return c }
        return query.focused ? .people : nil
    }
}
