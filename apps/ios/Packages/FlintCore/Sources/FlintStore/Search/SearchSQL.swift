// Parsed search to SQL over aliases `m` (messages) and `t` (threads). Ported from packages/core/src/search/sql.ts;
// the SQL text is pinned by the shared fixture search.json, so keep it identical to the TypeScript.

import Foundation
import GRDB

enum SearchParam: Hashable, Sendable {
    case text(String)
    case int(Int)

    var dbValue: any DatabaseValueConvertible {
        switch self {
        case .text(let s): s
        case .int(let n): n
        }
    }
}

struct SQLFragment: Sendable {
    var sql: String
    var params: [SearchParam]
}

enum SearchSQL {
    /// Roles that `in:` understands directly. Anything else is matched against folder names and paths.
    private static let inRoles: Set<String> = ["inbox", "sent", "drafts", "trash", "spam", "archive"]
    private static let ftsIn = "m.id IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)"

    /// SQL: message `m` is in a folder with this role. Written as IN (subquery) so SQLite can drive the query from the membership index.
    static func roleMember(_ role: String) -> String {
        "m.id IN (SELECT xf.message_id FROM message_folders xf JOIN folders xr ON xr.id = xf.folder_id WHERE xr.role = '\(role)')"
    }

    /// Same definition as the archive view in the thread list.
    static let archivePredicate: String = [
        "(",
        "  \(roleMember("archive"))",
        "  OR (EXISTS (SELECT 1 FROM accounts xa WHERE xa.id = m.account_id AND xa.provider = 'gmail')",
        "      AND \(roleMember("all"))",
        "      AND NOT \(roleMember("inbox")) AND NOT \(roleMember("trash")) AND NOT \(roleMember("spam"))",
        "      AND NOT \(roleMember("sent")) AND NOT \(roleMember("drafts")))",
        ")",
    ].joined(separator: "\n")

    /// Words an FTS5 unicode61 tokenizer would see in `text`: runs of letters and numbers.
    static func words(_ text: String) -> [String] {
        var out: [String] = []
        var current = String.UnicodeScalarView()
        for scalar in text.unicodeScalars {
            if isLetterOrNumber(scalar) {
                current.append(scalar)
            } else if !current.isEmpty {
                out.append(String(current))
                current = String.UnicodeScalarView()
            }
        }
        if !current.isEmpty { out.append(String(current)) }
        return out
    }

    private static func isLetterOrNumber(_ s: Unicode.Scalar) -> Bool {
        switch s.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
             .decimalNumber, .letterNumber, .otherNumber: true
        default: false
        }
    }

    /// FTS5 MATCH string for the positive bare terms. Every term is a quoted phrase of plain word characters, so user input
    /// can never be read as FTS syntax. The last bare word (not a phrase) gets a prefix match.
    static func buildMatch(_ terms: [SearchTerm], prefixLast: Bool) -> String? {
        let positive = terms.filter { !$0.negated }.map { (term: $0, words: words($0.text)) }.filter { !$0.words.isEmpty }
        if positive.isEmpty { return nil }
        return positive.enumerated().map { i, entry in
            let quoted = "\"\(entry.words.joined(separator: " "))\""
            return prefixLast && i == positive.count - 1 && !entry.term.phrase ? "\(quoted) *" : quoted
        }.joined(separator: " ")
    }

    private static func negatedMatches(_ terms: [SearchTerm]) -> [String] {
        terms.filter(\.negated).map { words($0.text) }.filter { !$0.isEmpty }.map { "\"\($0.joined(separator: " "))\"" }
    }

    private static func inFilter(_ f: SearchFilter) -> SQLFragment {
        let sql: String
        var params: [SearchParam] = []
        if f.value == "archive" { sql = archivePredicate }
        else if inRoles.contains(f.value) { sql = roleMember(f.value) }
        else {
            sql = "EXISTS (SELECT 1 FROM message_folders xf JOIN folders xr ON xr.id = xf.folder_id WHERE xf.message_id = m.id AND (lower(xr.name) = ? OR lower(xr.path) = ?))"
            params = [.text(f.value), .text(f.value)]
        }
        return SQLFragment(sql: f.negated ? "NOT \(sql)" : sql, params: params)
    }

    private static func likeFilter(_ column: String, _ f: SearchFilter) -> SQLFragment {
        SQLFragment(sql: "\(f.negated ? "NOT " : "")\(column) LIKE ? ESCAPE '\\'", params: [.text("%\(SQL.escapeLike(f.value))%")])
    }

    struct Where: Sendable {
        var sql: String
        var params: [SearchParam]
        /// True unless an `in:` filter says otherwise.
        var excludeTrashSpam: Bool
    }

    /// Turns a parsed search into a WHERE fragment over aliases `m` and `t`.
    static func buildWhere(_ p: ParsedSearch, now: Int) -> Where {
        var parts: [String] = []
        var params: [SearchParam] = []
        func add(_ f: SQLFragment) { parts.append(f.sql); params.append(contentsOf: f.params) }

        if let match = buildMatch(p.terms, prefixLast: true) { parts.append(ftsIn); params.append(.text(match)) }
        for neg in negatedMatches(p.terms) {
            parts.append("m.id NOT IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)")
            params.append(.text(neg))
        }
        for f in p.from { add(likeFilter("m.from_json", f)) }
        for f in p.to { add(likeFilter("m.to_json", f)) }
        for f in p.cc { add(likeFilter("m.cc_json", f)) }
        for f in p.subject { add(likeFilter("m.subject", f)) }
        for f in p.in { add(inFilter(f)) }
        for f in p.account {
            parts.append("\(f.negated ? "NOT " : "")m.account_id IN (SELECT id FROM accounts WHERE lower(email) = ? OR id = ?)")
            params.append(contentsOf: [.text(f.value), .text(f.value)])
        }
        if let v = p.hasAttachment { parts.append("m.has_attachments = \(v ? 1 : 0)") }
        if let v = p.unread { parts.append("m.seen = \(v ? 0 : 1)") }
        if let v = p.pinned { parts.append(v ? "t.pinned = 1" : "t.pinned = 0") }
        if let v = p.snoozed {
            parts.append(v ? "(t.snoozed_until IS NOT NULL AND t.snoozed_until > ?)" : "(t.snoozed_until IS NULL OR t.snoozed_until <= ?)")
            params.append(.int(now))
        }
        if let v = p.before { parts.append("m.date < ?"); params.append(.int(v)) }
        if let v = p.after { parts.append("m.date >= ?"); params.append(.int(v)) }

        let positiveIn = p.in.contains { !$0.negated }
        return Where(sql: parts.isEmpty ? "1=1" : parts.joined(separator: " AND "), params: params, excludeTrashSpam: !positiveIn)
    }

    /// True when the search has nothing to match on, so the caller can return an empty page.
    static func isEmpty(_ p: ParsedSearch) -> Bool {
        !p.terms.contains { !words($0.text).isEmpty }
            && p.from.count + p.to.count + p.cc.count + p.subject.count + p.in.count + p.account.count == 0
            && p.hasAttachment == nil && p.unread == nil && p.pinned == nil && p.snoozed == nil && p.before == nil && p.after == nil
    }
}
