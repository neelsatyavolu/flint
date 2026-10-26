// Optimistic archive, trash, spam, move to inbox and move to folder, expressed as folder membership. Gmail archive removes the
// INBOX label; generic IMAP archive means membership of the Archive folder. Sent and draft messages stay where they are for
// archive, inbox and folder moves. Ported from ThreadActionsRepo.moveThreads in store/threadActions.ts.

import FlintModel
import Foundation
import GRDB

enum ThreadMovesSQL {
    /// Resolves folders by role once per (account, role) while one move runs.
    final class Lookup {
        private let db: Database
        private var cache: [String: Int?] = [:]

        init(_ db: Database) { self.db = db }

        func folder(_ accountId: AccountID, _ role: MailboxRole, create: Bool = false) throws -> Int? {
            let key = "\(accountId):\(role.rawValue)"
            if let hit = cache[key] { return hit }
            let f = create ? try FoldersSQL.ensure(db, accountId, role) : try FoldersSQL.get(db, accountId: accountId, role: role)
            cache[key] = .some(f?.id)
            return f?.id
        }

        func need(_ accountId: AccountID, _ role: MailboxRole) throws -> Int {
            guard let id = try folder(accountId, role) else { throw FlintError(.notFound, "This account has no \(role.rawValue) folder yet.") }
            return id
        }
    }

    /// New folder membership for one message, or nil to leave it alone.
    private static func nextMembership(
        _ m: ThreadActionsSQL.MsgState, current: [Int], target: MoveTarget, gmail: Bool, roles: [Int: MailboxRole],
        lookup: Lookup, targetFolder: Folder?
    ) throws -> [Int]? {
        let curRoles = Set(current.compactMap { roles[$0] })
        let keep = curRoles.contains(.sent) || curRoles.contains(.drafts) || m.draft
        /// Membership without the folders that have one of these roles (folders with no role stay).
        func drop(_ rs: MailboxRole...) -> [Int] {
            current.filter { id in roles[id].map { !rs.contains($0) } ?? true }
        }
        func withAll(_ ids: [Int]) throws -> [Int] {
            guard gmail, let all = try lookup.folder(m.accountId, .all) else { return ids }
            return ids + [all]
        }
        switch target {
        case .trash: return m.draft ? nil : [try lookup.need(m.accountId, .trash)]
        case .spam: return m.draft ? nil : [try lookup.need(m.accountId, .spam)]
        case .archive:
            guard !keep || curRoles.contains(.inbox) else { return nil }
            if gmail { return try withAll(drop(.inbox, .trash, .spam)) }
            return [try lookup.folder(m.accountId, .archive, create: true)!]
        case .inbox:
            guard !keep else { return nil }
            let inbox = try lookup.need(m.accountId, .inbox)
            return gmail ? try withAll(drop(.trash, .spam) + [inbox]) : [inbox]
        case .folder:
            guard !keep, let targetFolder, targetFolder.accountId == m.accountId else { return nil }
            return gmail ? try withAll(drop(.inbox, .trash, .spam) + [targetFolder.id]) : [targetFolder.id]
        }
    }

    static func move(_ db: Database, _ threadIds: [ThreadID], to target: MoveTarget) throws -> ActionResult {
        try ThreadActionsSQL.apply(db, threadIds) { msgs in
            let members = try ThreadActionsSQL.members(db, msgs.map(\.id))
            let lookup = Lookup(db)
            var roles: [Int: MailboxRole] = [:]
            for f in try db.all("SELECT id, role FROM folders") {
                if let role = (f["role"] as String?).flatMap(MailboxRole.init(rawValue:)) { roles[f["id"]] = role }
            }
            let providers = Dictionary(uniqueKeysWithValues: try AccountsSQL.list(db).map { ($0.id, $0.provider) })
            var targetFolder: Folder?
            if case .folder(let id) = target { targetFolder = try FoldersSQL.require(db, id) }
            var changed: [MessageRowID] = []
            for m in msgs {
                let cur = members[m.id] ?? []
                guard let next = try nextMembership(
                    m, current: cur, target: target, gmail: providers[m.accountId] == .gmail, roles: roles, lookup: lookup, targetFolder: targetFolder)
                else { continue }
                var unique: [Int] = []
                for f in next where !unique.contains(f) { unique.append(f) }
                if unique.count == cur.count && unique.allSatisfy(cur.contains) { continue }
                try db.run("DELETE FROM message_folders WHERE message_id = ?", m.id)
                for f in unique { try db.run("INSERT OR IGNORE INTO message_folders (message_id, folder_id) VALUES (?,?)", m.id, f) }
                changed.append(m.id)
            }
            return changed
        }
    }
}

extension GRDBStore {
    public func moveThreads(_ threadIds: [ThreadID], to target: MoveTarget) async throws -> ActionResult {
        try await write { db in try ThreadMovesSQL.move(db, threadIds, to: target) }
    }
}
