// Parsed search to server-side queries (Gmail X-GM-RAW and plain IMAP SEARCH). Ported from packages/core/src/search/server.ts;
// shared fixture: search.json. The local database applies Flint's exact rules to whatever the server returns.

import Foundation

/// IMAP SEARCH criteria for a server without Gmail extensions. Dates are epoch ms at local midnight.
struct ImapSearchCriteria: Hashable, Sendable {
    var from: String?
    var to: String?
    var cc: String?
    var subject: String?
    var text: String?
    var seen: Bool?
    var flagged: Bool?
    var since: Int?
    var before: Int?

    var isEmpty: Bool { self == ImapSearchCriteria() }
}

enum SearchServer {
    /// Folder names in `in:` that mean a mailbox role rather than a user folder.
    private static let roleNames: Set<String> = ["inbox", "sent", "drafts", "trash", "spam", "archive"]

    private static func gmailDay(_ ms: Int, _ calendar: Calendar) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: Date(timeIntervalSince1970: Double(ms) / 1000))
        return String(format: "%04d/%02d/%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    private static func clean(_ s: String) -> String {
        s.replacingOccurrences(of: "[\"\\\\]", with: " ", options: .regularExpression)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func word(_ s: String) -> String { s.contains(where: \.isWhitespace) ? "\"\(s)\"" : s }

    private static func gmailFilter(_ key: String, _ f: SearchFilter) -> String? {
        let v = clean(f.value)
        return v.isEmpty ? nil : "\(f.negated ? "-" : "")\(key):\(word(v))"
    }

    private static func gmailIn(_ f: SearchFilter) -> String? {
        let v = clean(f.value)
        if v.isEmpty { return nil }
        let neg = f.negated ? "-" : ""
        if v == "archive" { return f.negated ? "in:inbox" : "-in:inbox -in:sent -in:drafts" }
        if roleNames.contains(v) { return "\(neg)in:\(v)" }
        let label = v.replacingOccurrences(of: "\\s+", with: "-", options: .regularExpression)
        return "\(neg)label:\(word(label))"
    }

    /// The query Gmail's X-GM-RAW understands for a parsed Flint search, or nil when there is nothing to ask the server.
    static func gmailRaw(_ p: ParsedSearch, calendar: Calendar = .current) -> String? {
        var parts: [String] = []
        for t in p.terms {
            let text = clean(t.text)
            if text.isEmpty { continue }
            parts.append("\(t.negated ? "-" : "")\(t.phrase ? "\"\(text)\"" : text)")
        }
        for (key, list) in [("from", p.from), ("to", p.to), ("cc", p.cc), ("subject", p.subject)] {
            for f in list { if let part = gmailFilter(key, f) { parts.append(part) } }
        }
        for f in p.in { if let part = gmailIn(f) { parts.append(part) } }
        if let v = p.hasAttachment { parts.append(v ? "has:attachment" : "-has:attachment") }
        if let v = p.unread { parts.append(v ? "is:unread" : "is:read") }
        if p.pinned == true { parts.append("is:starred") }
        if let v = p.after { parts.append("after:\(gmailDay(v, calendar))") }
        if let v = p.before { parts.append("before:\(gmailDay(v, calendar))") }
        return parts.isEmpty ? nil : parts.joined(separator: " ")
    }

    private static func firstPositive(_ list: [SearchFilter]) -> String? {
        list.first { !$0.negated && !clean($0.value).isEmpty }?.value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// IMAP criteria cannot repeat a key, so the most selective positive value of each kind is sent.
    static func imapCriteria(_ p: ParsedSearch) -> ImapSearchCriteria? {
        var out = ImapSearchCriteria()
        out.from = firstPositive(p.from)
        out.to = firstPositive(p.to)
        out.cc = firstPositive(p.cc)
        out.subject = firstPositive(p.subject)
        out.text = p.terms.filter { !$0.negated && !clean($0.text).isEmpty }
            .map { $0.text.trimmingCharacters(in: .whitespacesAndNewlines) }
            .sorted { $0.utf16.count > $1.utf16.count }.first
        if let v = p.unread { out.seen = !v }
        if p.pinned == true { out.flagged = true }
        out.since = p.after
        out.before = p.before
        return out.isEmpty ? nil : out
    }

    /// Folder hints from `in:` operators: mailbox roles and user folder names the query is limited to.
    static func inTargets(_ p: ParsedSearch) -> (roles: [String], names: [String]) {
        let wanted = p.in.filter { !$0.negated }.map { $0.value.lowercased() }
        return (wanted.filter { roleNames.contains($0) }, wanted.filter { !roleNames.contains($0) })
    }
}
