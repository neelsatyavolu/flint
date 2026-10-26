// Header names requested with every envelope fetch, and small RFC 5322 header helpers.
// Port of packages/core/src/mail/sync/headers.ts.

import Foundation

public enum MailHeaders {
    /// Headers requested with every envelope fetch (lower-case). Same list as `FETCH_HEADERS` on desktop.
    public static let fetchHeaders: [String] = [
        "references", "list-unsubscribe", "list-unsubscribe-post", "list-id", "precedence", "auto-submitted", "x-flint-ref",
        "x-github-reason", "x-auto-response-suppress", "feedback-id",
        "return-path", "x-mailer", "x-campaign", "x-campaignid", "x-mailgun-sid", "x-mailgun-variables", "x-ses-outgoing", "x-sg-eid", "x-sg-id",
        "x-mc-user", "x-mandrill-user", "x-sfmc-stack", "x-sfdc-lk", "x-hs-cid", "x-linear-team", "x-linear-project", "x-linear-id", "x-linear-issue",
        "authentication-results", "list-post",
    ]

    /// Parses a raw header block (with folding) into lower-case names. A repeated header keeps its first value.
    public static func parse(_ raw: String) -> [String: String] {
        var out: [String: String] = [:]
        var unfolded = raw.replacingOccurrences(of: "\r\n", with: "\n")
        while let range = unfolded.range(of: "\n[ \t]+", options: .regularExpression) {
            unfolded.replaceSubrange(range, with: " ")
        }
        for line in unfolded.split(separator: "\n", omittingEmptySubsequences: true) {
            guard let colon = line.firstIndex(of: ":"), colon != line.startIndex else { continue }
            let name = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
            if out[name] == nil { out[name] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces) }
        }
        return out
    }

    /// Message-IDs from a References header, brackets removed.
    public static func parseReferences(_ value: String?) -> [String] {
        guard let value, !value.isEmpty else { return [] }
        var out: [String] = []
        var rest = Substring(value)
        while let open = rest.firstIndex(of: "<"), let close = rest[open...].firstIndex(of: ">") {
            let id = rest[rest.index(after: open)..<close]
            if !id.isEmpty, !id.contains(where: { $0.isWhitespace || $0 == "<" }) { out.append(String(id)) }
            rest = rest[rest.index(after: close)...]
        }
        return out
    }

    /// `<id>` form of a Message-ID given with or without brackets.
    public static func bracketed(_ id: String) -> String { "<\(unbracketed(id))>" }

    public static func unbracketed(_ id: String) -> String {
        var s = Substring(id.trimmingCharacters(in: .whitespaces))
        if s.hasPrefix("<") { s = s.dropFirst() }
        if s.hasSuffix(">") { s = s.dropLast() }
        return String(s)
    }
}
