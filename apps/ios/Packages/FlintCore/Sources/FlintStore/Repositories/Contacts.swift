// Contacts used for autocomplete and for "known sender" categorization. Ported from store/contacts.ts.

import FlintModel
import Foundation
import GRDB

enum ContactsSQL {
    static func touch(_ db: Database, _ a: Address, date: EpochMs, sent: Bool) throws {
        let email = lowerAddress(a)
        if email.isEmpty { return }
        let column = sent ? "sent_count" : "received_count"
        try db.run(
            """
            INSERT INTO contacts (email, name, \(column), last_seen) VALUES (?,?,1,?)
            ON CONFLICT (email) DO UPDATE SET \(column) = \(column) + 1,
              name = CASE WHEN contacts.name = '' THEN excluded.name ELSE contacts.name END,
              last_seen = MAX(last_seen, excluded.last_seen)
            """,
            email, a.name, date)
    }

    /// True when the user has written to this address (sent_count > 0).
    static func hasSentTo(_ db: Database, _ address: String) throws -> Bool {
        let key = address.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return (try Int.fetchOne(db, sql: "SELECT sent_count FROM contacts WHERE email = ?", arguments: [key]) ?? 0) > 0
    }
}

extension GRDBStore: ContactsRepository {
    public func touchReceived(_ address: Address, date: EpochMs) async throws {
        try await write { db in try ContactsSQL.touch(db, address, date: date, sent: false) }
    }

    public func touchSent(_ address: Address, date: EpochMs) async throws {
        try await write { db in try ContactsSQL.touch(db, address, date: date, sent: true) }
    }

    public func hasSentTo(_ address: String) async throws -> Bool {
        try await read { db in try ContactsSQL.hasSentTo(db, address) }
    }

    /// Autocomplete: prefix on the address or on any word of the name, ranked by sent_count*3 + received_count, then recency.
    public func suggestContacts(prefix: String, limit: Int) async throws -> [Contact] {
        let p = SQL.escapeLike(prefix.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
        if p.isEmpty { return [] }
        let cap = max(1, min(limit, 50))
        return try await read { db in
            try db.all(
                """
                SELECT email, name, sent_count * 3 + received_count AS score FROM contacts
                WHERE email LIKE ? ESCAPE '\\' OR lower(name) LIKE ? ESCAPE '\\' OR lower(name) LIKE ? ESCAPE '\\'
                ORDER BY score DESC, last_seen DESC, email LIMIT ?
                """,
                "\(p)%", "\(p)%", "% \(p)%", cap
            ).map { Contact(email: $0["email"], name: $0["name"], score: Double($0["score"] as Int)) }
        }
    }
}
