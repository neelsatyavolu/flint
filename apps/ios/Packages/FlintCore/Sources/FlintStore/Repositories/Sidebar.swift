// Sidebar accounts, folders and badge counts. Ported from store/dashboard.ts (getSidebarData) and store/folderList.ts.

import FlintModel
import Foundation
import GRDB

enum SidebarSQL {
    /// Roles that duplicate another view: All Mail is the archive, Important and Starred are flags on mail already in the inbox.
    private static let hiddenRoles: Set<MailboxRole> = [.all, .important, .flagged]
    /// Names the sidebar and system folders already use, so a user folder with the same name needs a suffix.
    private static let systemNames: Set<String> = ["inbox", "sent", "drafts", "trash", "spam", "junk", "archive", "important", "starred", "all mail", "bin"]

    /// Folders for the sidebar: drops the all/important/flagged duplicates, and renames user folders and labels whose name
    /// collides with another folder or a system name, so one account never shows two folders with the same name.
    static func folders(_ folders: [Folder]) -> [Folder] {
        let visible = folders.filter { $0.role.map { !hiddenRoles.contains($0) } ?? true }
        func key(_ name: String) -> String { name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        var counts: [String: Int] = [:]
        for f in visible { counts[key(f.name), default: 0] += 1 }
        var taken = Set<String>()
        let ordered = visible.enumerated().sorted { a, b in
            let (x, y) = (a.element.role != nil, b.element.role != nil)
            return x != y ? x : a.offset < b.offset
        }.map(\.element)
        var renamed: [Int: String] = [:]
        for f in ordered {
            var name = f.name
            let clash = f.role == nil && ((counts[key(name)] ?? 0) > 1 || systemNames.contains(key(name)) || taken.contains(key(name)))
            if clash {
                name = "\(f.name) (label)"
                if taken.contains(key(name)) {
                    name = f.path.replacingOccurrences(of: "[/.]", with: " / ", options: .regularExpression)
                }
                var n = 2
                while taken.contains(key(name)) {
                    name = "\(f.name) (label \(n))"
                    n += 1
                }
            }
            taken.insert(key(name))
            renamed[f.id] = name
        }
        return visible.map { f in
            var out = f
            out.name = renamed[f.id] ?? f.name
            return out
        }
    }

    /// Accounts with folder counts, plus badge counts. `inbox` and per-account `inboxUnread` count threads with an unread message
    /// in the inbox (snoozed and blocked excluded); `spam` counts threads with unread spam; `pinned` and `snoozed` count threads.
    static func sidebar(_ db: Database, now: EpochMs) throws -> SidebarData {
        let accounts = try AccountsSQL.list(db)
        guard let inboxWhere = ThreadViews.predicate(ThreadQuery(view: .inbox), now: now, blocked: try RulesSQL.blockedPatterns(db)) else {
            return SidebarData(accounts: [], counts: SidebarCounts())
        }
        var unread: [String: Int] = [:]
        let inboxArgs: [SQLArg] = inboxWhere.params.map(\.dbValue)
        for r in try db.all(
            """
            SELECT m.account_id, COUNT(DISTINCT m.thread_id) AS n FROM messages m JOIN threads t ON t.id = m.thread_id
            WHERE (\(inboxWhere.sql)) AND m.seen = 0 AND m.draft = 0 GROUP BY m.account_id
            """, args: inboxArgs) {
            unread[r["account_id"]] = r["n"]
        }
        // All-accounts counts leave out disabled accounts and accounts hidden from the unified inbox.
        let enabled = Set(accounts.filter { $0.enabled && $0.showInUnified }.map(\.id))
        let sidebarAccounts = try accounts.map { account in
            let last = try Int.fetchOne(db, sql: "SELECT MAX(last_sync_at) FROM folders WHERE account_id = ?", arguments: [account.id])
            return SidebarAccount(
                account: account, inboxUnread: unread[account.id] ?? 0, folders: folders(try FoldersSQL.list(db, account.id)),
                sync: SyncStatus(accountId: account.id, state: .idle, lastSyncAt: last))
        }
        func onEnabled(_ rows: [Row]) -> Int { rows.reduce(0) { $0 + (enabled.contains($1["account_id"]) ? ($1["n"] as Int) : 0) } }
        let trashOrSpam = "NOT \(SearchSQL.roleMember("trash")) AND NOT \(SearchSQL.roleMember("spam"))"
        let pinned = onEnabled(try db.all(
            "SELECT t.account_id, COUNT(*) AS n FROM threads t WHERE t.pinned = 1 AND EXISTS (SELECT 1 FROM messages m WHERE m.thread_id = t.id AND \(trashOrSpam)) GROUP BY t.account_id"))
        let snoozed = onEnabled(try db.all("SELECT account_id, COUNT(*) AS n FROM threads WHERE snoozed_until > ? GROUP BY account_id", now))
        let spam = onEnabled(try db.all("SELECT m.account_id, COUNT(DISTINCT m.thread_id) AS n FROM messages m WHERE \(SearchSQL.roleMember("spam")) AND m.seen = 0 GROUP BY m.account_id"))
        guard let serverDrafts = ThreadViews.predicate(ThreadQuery(view: .drafts), now: now, blocked: []) else {
            return SidebarData(accounts: sidebarAccounts, counts: SidebarCounts())
        }
        let draftArgs: [SQLArg] = serverDrafts.params.map(\.dbValue)
        let drafts = try db.count("SELECT COUNT(*) FROM drafts WHERE \(inUnified("account_id")) AND \(MessagesSQL.notQueuedDraft)")
            + (try Int.fetchOne(
                db,
                sql: "SELECT COUNT(DISTINCT m.thread_id) FROM messages m JOIN threads t ON t.id = m.thread_id WHERE \(serverDrafts.sql) AND \(inUnified("m.account_id"))",
                arguments: StatementArguments(draftArgs)) ?? 0)
        return SidebarData(
            accounts: sidebarAccounts,
            counts: SidebarCounts(
                inbox: unread.reduce(0) { $0 + (enabled.contains($1.key) ? $1.value : 0) }, pinned: pinned, drafts: drafts, snoozed: snoozed,
                scheduled: try db.count("SELECT COUNT(*) FROM scheduled_sends WHERE status IN ('pending','sending')"), spam: spam))
    }
}

extension GRDBStore {
    public func sidebarData(now: EpochMs) async throws -> SidebarData {
        try await read { db in try SidebarSQL.sidebar(db, now: now) }
    }
}
