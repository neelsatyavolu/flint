// Signatures and templates. Ported from the LibraryRepo half of store/library.ts.

import FlintModel
import Foundation
import GRDB

enum LibrarySQL {
    static func signature(_ r: Row) -> Signature {
        Signature(
            id: r["id"], name: r["name"], html: r["html"], accountIds: JSONColumn.decode(r["account_ids"], fallback: [String]()),
            defaultNew: r.bool("default_new"), defaultReply: r.bool("default_reply"))
    }

    static func signatures(_ db: Database) throws -> [Signature] {
        try db.all("SELECT * FROM signatures ORDER BY name COLLATE NOCASE, id").map(signature)
    }

    static func signature(_ db: Database, _ id: Int) throws -> Signature? {
        try db.first("SELECT * FROM signatures WHERE id = ?", id).map(signature)
    }

    /// Two scopes overlap when either is every account or they share an account.
    private static func scopesOverlap(_ a: [String], _ b: [String]) -> Bool {
        a.isEmpty || b.isEmpty || a.contains { b.contains($0) }
    }

    /// Insert or update (`id <= 0` inserts). A default for new mail or for replies is unique per account: saving one clears the
    /// flag on signatures whose accounts overlap.
    static func saveSignature(_ db: Database, _ input: Signature, now: EpochMs) throws -> Signature {
        guard !input.name.isEmpty, input.name.count <= 120, input.html.count <= 200_000,
              input.accountIds.count <= 100, input.accountIds.allSatisfy({ !$0.isEmpty })
        else { throw FlintError(.invalid, "That signature is not valid.") }
        var seen = Set<String>()
        let accountIds = input.accountIds.filter { seen.insert($0).inserted }
        let ids = JSONColumn.encode(accountIds)
        var id = input.id
        if id > 0 {
            guard try signature(db, id) != nil else { throw FlintError(.notFound, "That signature no longer exists.") }
            try db.run(
                "UPDATE signatures SET name=?, html=?, account_ids=?, default_new=?, default_reply=?, updated_at=? WHERE id=?",
                input.name, input.html, ids, input.defaultNew, input.defaultReply, now, id)
        } else {
            id = try db.insert(
                "INSERT INTO signatures (name, html, account_ids, default_new, default_reply, updated_at) VALUES (?,?,?,?,?,?)",
                input.name, input.html, ids, input.defaultNew, input.defaultReply, now)
        }
        for other in try signatures(db) where other.id != id && scopesOverlap(other.accountIds, accountIds) {
            if input.defaultNew && other.defaultNew { try db.run("UPDATE signatures SET default_new = 0 WHERE id = ?", other.id) }
            if input.defaultReply && other.defaultReply { try db.run("UPDATE signatures SET default_reply = 0 WHERE id = ?", other.id) }
        }
        return try signature(db, id)!
    }

    static func template(_ r: Row) -> Template {
        Template(id: r["id"], name: r["name"], subject: r["subject"], html: r["html"])
    }

    static func template(_ db: Database, _ id: Int) throws -> Template? {
        try db.first("SELECT id, name, subject, html FROM templates WHERE id = ?", id).map(template)
    }

    static func saveTemplate(_ db: Database, _ t: Template, now: EpochMs) throws -> Template {
        guard !t.name.isEmpty, t.name.count <= 120, t.subject.count <= 500, t.html.count <= 200_000 else {
            throw FlintError(.invalid, "That template is not valid.")
        }
        if t.id > 0 {
            guard try template(db, t.id) != nil else { throw FlintError(.notFound, "That template no longer exists.") }
            try db.run("UPDATE templates SET name=?, subject=?, html=?, updated_at=? WHERE id=?", t.name, t.subject, t.html, now, t.id)
            return try template(db, t.id)!
        }
        let id = try db.insert("INSERT INTO templates (name, subject, html, updated_at) VALUES (?,?,?,?)", t.name, t.subject, t.html, now)
        return try template(db, id)!
    }
}

extension GRDBStore: LibraryRepository {
    public func listSignatures() async throws -> [Signature] {
        try await read { db in try LibrarySQL.signatures(db) }
    }

    public func signature(id: Int) async throws -> Signature? {
        try await read { db in try LibrarySQL.signature(db, id) }
    }

    /// `signature.id <= 0` creates; otherwise replaces.
    public func saveSignature(_ signature: Signature, now: EpochMs) async throws -> Signature {
        try await write { db in try LibrarySQL.saveSignature(db, signature, now: now) }
    }

    public func deleteSignature(_ id: Int) async throws {
        try await write { db in try db.run("DELETE FROM signatures WHERE id = ?", id) }
    }

    public func listTemplates() async throws -> [Template] {
        try await read { db in
            try db.all("SELECT id, name, subject, html FROM templates ORDER BY name COLLATE NOCASE, id").map(LibrarySQL.template)
        }
    }

    public func template(id: Int) async throws -> Template? {
        try await read { db in try LibrarySQL.template(db, id) }
    }

    /// `template.id <= 0` creates; otherwise replaces.
    public func saveTemplate(_ template: Template, now: EpochMs) async throws -> Template {
        try await write { db in try LibrarySQL.saveTemplate(db, template, now: now) }
    }

    public func deleteTemplate(_ id: Int) async throws {
        try await write { db in try db.run("DELETE FROM templates WHERE id = ?", id) }
    }
}
