// Server-side search: what a parsed Flint query asks the server, and which folders to ask.
// Port of the search plans in packages/core/src/mail/sync/accountSync.ts (shared fixture: search.json, buildImapCriteria and
// inTargets cases).
//
// Gmail normally takes X-GM-RAW, which SwiftMail cannot send. Gmail's plain IMAP SEARCH (TEXT, FROM, SUBJECT, SINCE...) uses
// the same index, so Gmail gets the same criteria, in All Mail (or Trash / Spam when the query says so).

import FlintModel
import Foundation

public struct ServerSearchQuery: Hashable, Sendable {
    public var from: String?
    public var to: String?
    public var cc: String?
    public var subject: String?
    public var text: String?
    public var seen: Bool?
    public var flagged: Bool?
    /// Messages on or after this day (local midnight).
    public var since: Date?
    /// Messages before this day (local midnight).
    public var before: Date?

    public init(
        from: String? = nil, to: String? = nil, cc: String? = nil, subject: String? = nil, text: String? = nil, seen: Bool? = nil, flagged: Bool? = nil,
        since: Date? = nil, before: Date? = nil
    ) {
        self.from = from
        self.to = to
        self.cc = cc
        self.subject = subject
        self.text = text
        self.seen = seen
        self.flagged = flagged
        self.since = since
        self.before = before
    }

    /// The IMAP criteria for this query, or nil when there is nothing to ask the server.
    public func criteria() -> SearchCriteria? {
        var parts: [SearchCriteria] = []
        for (name, value) in [("from", from), ("to", to), ("cc", cc), ("subject", subject)] {
            if let value, !value.isEmpty { parts.append(.header(name: name, value: value)) }
        }
        if let text, !text.isEmpty { parts.append(.text(text)) }
        if let seen { parts.append(seen ? .seen : .unseen) }
        if flagged == true { parts.append(.flagged) }
        if let since { parts.append(.since(since)) }
        if let before { parts.append(.before(before)) }
        switch parts.count {
        case 0: return nil
        case 1: return parts[0]
        default: return .and(parts)
        }
    }
}

public enum ServerSearchPlanner {
    private static let roleNames: Set<String> = ["inbox", "sent", "drafts", "trash", "spam", "archive"]

    /// Which folders to search.
    /// - Parameters:
    ///   - roles: mailbox roles named by `in:` (lower-case).
    ///   - names: user folder names named by `in:` (lower-case).
    ///   - synced: folders that have been synced at least once; an unsynced folder has no local state to merge results into.
    public static func plan(
        _ query: ServerSearchQuery, roles: [String] = [], names: [String] = [], folders: [Folder], synced: Set<FolderID>, gmail: Bool
    ) -> [ServerSearch] {
        guard let criteria = query.criteria() else { return [] }
        if gmail {
            let role: MailboxRole = roles.contains("trash") ? .trash : roles.contains("spam") ? .spam : .all
            return folders.first { $0.role == role }.map { [ServerSearch(folderId: $0.id, criteria: criteria)] } ?? []
        }
        let candidates = folders.filter { synced.contains($0.id) }
        let picked: [Folder]
        if roles.isEmpty && names.isEmpty {
            picked = candidates.filter { [.inbox, .sent, .archive, nil].contains($0.role) }
        } else {
            let wantedRoles = Set(roles.compactMap(MailboxRole.init(rawValue:)))
            picked = candidates.filter { folder in
                (folder.role.map(wantedRoles.contains) ?? false) || names.contains(folder.name.lowercased())
            }
        }
        return picked.map { ServerSearch(folderId: $0.id, criteria: criteria) }
    }
}

extension AccountSession {
    /// Searches the server for a query and ingests matches that are not local yet. Roles and names come from the parsed `in:` operators.
    public func searchServer(_ query: ServerSearchQuery, roles: [String] = [], names: [String] = []) async throws -> (found: Int, added: Int) {
        let folders = try await folderList()
        var synced = Set<FolderID>()
        for folder in folders { if try await folderIsSynced(folder.id) { synced.insert(folder.id) } }
        let plan = ServerSearchPlanner.plan(query, roles: roles, names: names, folders: folders, synced: synced, gmail: try await gmailMode())
        return try await searchServer(plan)
    }
}
