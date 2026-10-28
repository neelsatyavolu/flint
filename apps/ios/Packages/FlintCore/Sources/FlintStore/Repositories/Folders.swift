// Folders and their sync state. Ported from store/folders.ts.

import FlintModel
import Foundation
import GRDB

enum FoldersSQL {
    static let counts = """
      (SELECT COUNT(*) FROM message_folders mf JOIN messages m ON m.id = mf.message_id WHERE mf.folder_id = f.id AND m.seen = 0 AND m.draft = 0) AS unread,
      (SELECT COUNT(*) FROM message_folders mf WHERE mf.folder_id = f.id) AS total
    """

    static let defaultPaths: [MailboxRole: String] = [
        .archive: "Archive", .trash: "Trash", .spam: "Junk", .sent: "Sent", .drafts: "Drafts", .inbox: "INBOX",
    ]

    static func folder(_ r: Row) -> Folder {
        Folder(
            id: r["id"], accountId: r["account_id"], path: r["path"], name: r["name"],
            role: (r["role"] as String?).flatMap(MailboxRole.init(rawValue:)), unread: r["unread"] ?? 0, total: r["total"] ?? 0)
    }

    private static func baseName(_ path: String, _ delimiter: String?) -> String {
        let d = (delimiter?.isEmpty == false) ? delimiter! : "/"
        return path.components(separatedBy: d).last.flatMap { $0.isEmpty ? nil : $0 } ?? path
    }

    static func get(_ db: Database, id: FolderID) throws -> Folder? {
        try db.first("SELECT f.*, \(counts) FROM folders f WHERE f.id = ?", id).map(folder)
    }

    static func require(_ db: Database, _ id: FolderID) throws -> Folder {
        guard let f = try get(db, id: id) else { throw FlintError(.notFound, "That folder no longer exists.") }
        return f
    }

    static func get(_ db: Database, accountId: AccountID, path: String) throws -> Folder? {
        try db.first("SELECT f.*, \(counts) FROM folders f WHERE f.account_id = ? AND f.path = ?", accountId, path).map(folder)
    }

    static func get(_ db: Database, accountId: AccountID, role: MailboxRole) throws -> Folder? {
        try db.first("SELECT f.*, \(counts) FROM folders f WHERE f.account_id = ? AND f.role = ? ORDER BY f.id LIMIT 1", accountId, role.rawValue).map(folder)
    }

    /// Creates or updates a folder by (account, path). A nil role never clears an existing role.
    static func upsert(_ db: Database, _ accountId: AccountID, _ input: FolderInput) throws -> Folder {
        try db.run(
            """
            INSERT INTO folders (account_id, path, name, delimiter, role, special_use) VALUES (?,?,?,?,?,?)
            ON CONFLICT (account_id, path) DO UPDATE SET
              name = excluded.name,
              delimiter = COALESCE(excluded.delimiter, folders.delimiter),
              role = COALESCE(excluded.role, folders.role),
              special_use = COALESCE(excluded.special_use, folders.special_use)
            """,
            accountId, input.path, input.name ?? baseName(input.path, input.delimiter), input.delimiter, input.role?.rawValue, input.specialUse)
        return try get(db, accountId: accountId, path: input.path)!
    }

    /// Returns the folder for a role, creating a local row (default path) when the server has none yet.
    static func ensure(_ db: Database, _ accountId: AccountID, _ role: MailboxRole) throws -> Folder {
        if let found = try get(db, accountId: accountId, role: role) { return found }
        guard let path = defaultPaths[role] else { throw FlintError(.notFound, "This account has no \(role.rawValue) folder yet.") }
        return try upsert(db, accountId, FolderInput(path: path, role: role))
    }

    static func syncState(_ db: Database, _ id: FolderID) throws -> FolderSyncState {
        guard let r = try db.first("SELECT uid_validity, uid_next, highest_modseq, synced_min_uid, last_sync_at FROM folders WHERE id = ?", id) else {
            throw FlintError(.notFound, "That folder no longer exists.")
        }
        return FolderSyncState(
            uidValidity: r["uid_validity"], uidNext: r["uid_next"], highestModseq: r["highest_modseq"],
            syncedMinUid: r["synced_min_uid"], lastSyncAt: r["last_sync_at"])
    }

    static func setSyncState(_ db: Database, _ id: FolderID, _ patch: FolderSyncPatch) throws {
        var sets: [String] = []
        var args: [SQLArg] = []
        func set(_ column: String, _ value: SQLArg) { sets.append("\(column) = ?"); args.append(value) }
        if let v = patch.uidValidity { set("uid_validity", v) }
        if let v = patch.uidNext { set("uid_next", v) }
        if let v = patch.highestModseq { set("highest_modseq", v) }
        if let v = patch.syncedMinUid { set("synced_min_uid", v) }
        if let v = patch.lastSyncAt { set("last_sync_at", v) }
        if !sets.isEmpty { try db.run("UPDATE folders SET \(sets.joined(separator: ", ")) WHERE id = ?", args: args + [id]) }
    }
}

extension GRDBStore: FoldersRepository {
    public func upsertFolder(_ accountId: AccountID, _ input: FolderInput) async throws -> Folder {
        try await write { db in try FoldersSQL.upsert(db, accountId, input) }
    }

    public func folder(id: FolderID) async throws -> Folder? {
        try await read { db in try FoldersSQL.get(db, id: id) }
    }

    public func folder(accountId: AccountID, path: String) async throws -> Folder? {
        try await read { db in try FoldersSQL.get(db, accountId: accountId, path: path) }
    }

    public func folder(accountId: AccountID, role: MailboxRole) async throws -> Folder? {
        try await read { db in try FoldersSQL.get(db, accountId: accountId, role: role) }
    }

    public func ensureFolder(accountId: AccountID, role: MailboxRole) async throws -> Folder {
        try await write { db in try FoldersSQL.ensure(db, accountId, role) }
    }

    /// Folders with unread (unseen non-draft messages) and total message counts. Gmail counts come from labels via message_folders.
    public func listFolders(accountId: AccountID) async throws -> [Folder] {
        try await read { db in try FoldersSQL.list(db, accountId) }
    }

    public func folderSyncState(_ folderId: FolderID) async throws -> FolderSyncState {
        try await read { db in try FoldersSQL.syncState(db, folderId) }
    }

    public func setFolderSyncState(_ folderId: FolderID, _ patch: FolderSyncPatch) async throws {
        try await write { db in try FoldersSQL.setSyncState(db, folderId, patch) }
    }

    /// UIDVALIDITY changed: drops every message whose UID lives in this folder and clears the sync window.
    public func resetFolder(_ folderId: FolderID) async throws -> [ThreadID] {
        try await write { db in
            let ids = try db.all("SELECT id FROM messages WHERE folder_id = ?", folderId).map { $0["id"] as Int }
            let threads = try Rollup.deleteMessages(db, ids)
            try db.run("UPDATE folders SET uid_validity = NULL, uid_next = NULL, highest_modseq = NULL, synced_min_uid = NULL, last_sync_at = NULL WHERE id = ?", folderId)
            return threads
        }
    }
}

extension FoldersSQL {
    static func list(_ db: Database, _ accountId: AccountID) throws -> [Folder] {
        try db.all("SELECT f.*, \(counts) FROM folders f WHERE f.account_id = ? ORDER BY f.name COLLATE NOCASE", accountId).map(folder)
    }
}
