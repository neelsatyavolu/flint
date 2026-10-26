// Accounts. Ported from store/accounts.ts.

import FlintModel
import Foundation
import GRDB

enum AccountsSQL {
    static func account(_ r: Row) -> Account {
        Account(
            id: r["id"], email: r["email"], name: r["name"], provider: MailProvider(rawValue: r["provider"]) ?? .imap,
            authKind: AuthKind(rawValue: r["auth_kind"]) ?? .password,
            server: ServerConfig(
                imapHost: r["imap_host"], imapPort: r["imap_port"], imapSecure: r.bool("imap_secure"),
                smtpHost: r["smtp_host"], smtpPort: r["smtp_port"], smtpSecure: r.bool("smtp_secure"), username: r["username"]),
            color: r["color"], sortOrder: r["sort_order"], enabled: r.bool("enabled"),
            aliases: JSONColumn.decode(r["aliases"], fallback: [String]()), createdAt: r["created_at"],
            showInUnified: r.bool("show_in_unified"),
            avatarSource: (r["avatar_source"] as String?).flatMap(AvatarSource.init(rawValue:)), avatarUpdatedAt: r["avatar_updated_at"])
    }

    static func get(_ db: Database, _ id: AccountID) throws -> Account? {
        try db.first("SELECT * FROM accounts WHERE id = ?", id).map(account)
    }

    static func require(_ db: Database, _ id: AccountID) throws -> Account {
        guard let a = try get(db, id) else { throw FlintError(.notFound, "That account no longer exists.") }
        return a
    }

    static func list(_ db: Database) throws -> [Account] {
        try db.all("SELECT * FROM accounts ORDER BY sort_order, created_at, id").map(account)
    }

    /// Lowercase addresses (primary and aliases) of every account: what counts as "me".
    static func ownAddresses(_ db: Database) throws -> Set<String> {
        var out = Set<String>()
        for a in try list(db) {
            out.insert(a.email.lowercased())
            for alias in a.aliases { out.insert(alias.lowercased()) }
        }
        return out
    }

    static func create(_ db: Database, _ input: NewAccount, now: EpochMs) throws -> Account {
        let id = input.id ?? makeAccountID()
        let sortOrder = try input.sortOrder ?? (Int.fetchOne(db, sql: "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM accounts") ?? 0)
        let s = input.server
        do {
            try db.run(
                """
                INSERT INTO accounts (id, email, name, provider, auth_kind, imap_host, imap_port, imap_secure, smtp_host, smtp_port,
                  smtp_secure, username, color, sort_order, enabled, aliases, created_at, show_in_unified)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                id, input.email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(), input.name, input.provider.rawValue,
                input.authKind.rawValue, s.imapHost, s.imapPort, s.imapSecure, s.smtpHost, s.smtpPort, s.smtpSecure, s.username,
                input.color, sortOrder, input.enabled ?? true, JSONColumn.encode((input.aliases ?? []).map { $0.lowercased() }),
                input.createdAt ?? now, input.showInUnified ?? true)
        } catch let e as DatabaseError where e.extendedResultCode == .SQLITE_CONSTRAINT_UNIQUE || e.extendedResultCode == .SQLITE_CONSTRAINT_PRIMARYKEY {
            throw FlintError(.conflict, "That account is already added.")
        }
        return try require(db, id)
    }

    static func update(_ db: Database, _ id: AccountID, _ patch: AccountPatch) throws -> Account {
        _ = try require(db, id)
        var sets: [String] = []
        var args: [SQLArg] = []
        func set(_ column: String, _ value: SQLArg) { sets.append("\(column) = ?"); args.append(value) }
        if let v = patch.email { set("email", v.lowercased()) }
        if let v = patch.name { set("name", v) }
        if let s = patch.server {
            set("imap_host", s.imapHost); set("imap_port", s.imapPort); set("imap_secure", s.imapSecure)
            set("smtp_host", s.smtpHost); set("smtp_port", s.smtpPort); set("smtp_secure", s.smtpSecure); set("username", s.username)
        }
        if let v = patch.provider { set("provider", v.rawValue) }
        if let v = patch.authKind { set("auth_kind", v.rawValue) }
        if let v = patch.color { set("color", v) }
        if let v = patch.sortOrder { set("sort_order", v) }
        if let v = patch.enabled { set("enabled", v) }
        if let v = patch.aliases { set("aliases", JSONColumn.encode(v.map { $0.lowercased() })) }
        if let v = patch.showInUnified { set("show_in_unified", v) }
        if let v = patch.avatarSource { set("avatar_source", v?.rawValue) }
        if let v = patch.avatarUpdatedAt { set("avatar_updated_at", v) }
        if !sets.isEmpty { try db.run("UPDATE accounts SET \(sets.joined(separator: ", ")) WHERE id = ?", args: args + [id]) }
        return try require(db, id)
    }

    /// Signatures list their accounts in a JSON column, so no foreign key follows them. A signature only this account used goes
    /// with it; one shared with others just loses the account. The legacy account_id column is cleared so its ON DELETE CASCADE
    /// cannot remove a signature that other accounts still use.
    static func dropFromSignatures(_ db: Database, _ id: AccountID) throws {
        try db.run("UPDATE signatures SET account_id = NULL WHERE account_id = ?", id)
        for r in try db.all("SELECT id, account_ids FROM signatures WHERE account_ids <> '[]'") {
            let ids = JSONColumn.decode(r["account_ids"], fallback: [String]())
            guard ids.contains(id) else { continue }
            let rest = ids.filter { $0 != id }
            let sigId: Int = r["id"]
            if rest.isEmpty { try db.run("DELETE FROM signatures WHERE id = ?", sigId) }
            else { try db.run("UPDATE signatures SET account_ids = ? WHERE id = ?", JSONColumn.encode(rest), sigId) }
        }
    }

    /// Removes the account with its mail, folders and drafts. Search index rows are cleared too.
    static func delete(_ db: Database, _ id: AccountID) throws {
        try db.run("DELETE FROM messages_fts WHERE rowid IN (SELECT id FROM messages WHERE account_id = ?)", id)
        try db.run("DELETE FROM messages WHERE account_id = ?", id)
        try dropFromSignatures(db, id)
        try db.run("DELETE FROM accounts WHERE id = ?", id)
    }
}

extension Database {
    @discardableResult
    func run(_ sql: String, args: [SQLArg]) throws -> Int {
        try execute(sql: sql, arguments: StatementArguments(args))
        return changesCount
    }
}

extension GRDBStore: AccountsRepository {
    public func accountHasMessages(_ id: AccountID) async throws -> Bool {
        try await read { db in try db.exists("SELECT 1 FROM messages WHERE account_id = ? LIMIT 1", id) }
    }

    public func createAccount(_ input: NewAccount) async throws -> Account {
        let now = clock()
        return try await write { db in try AccountsSQL.create(db, input, now: now) }
    }

    public func account(id: AccountID) async throws -> Account? {
        try await read { db in try AccountsSQL.get(db, id) }
    }

    public func account(email: String) async throws -> Account? {
        let key = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return try await read { db in try db.first("SELECT * FROM accounts WHERE email = ?", key).map(AccountsSQL.account) }
    }

    public func listAccounts() async throws -> [Account] {
        try await read { db in try AccountsSQL.list(db) }
    }

    public func updateAccount(_ id: AccountID, _ patch: AccountPatch) async throws -> Account {
        try await write { db in try AccountsSQL.update(db, id, patch) }
    }

    public func deleteAccount(_ id: AccountID) async throws {
        try await write { db in try AccountsSQL.delete(db, id) }
    }

    public func ownAddresses() async throws -> Set<String> {
        try await read { db in try AccountsSQL.ownAddresses(db) }
    }
}
