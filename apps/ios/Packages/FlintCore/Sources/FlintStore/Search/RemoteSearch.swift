// Public view of a Flint search string for server-side search (track 2F, requested in HANDOFF by 2A and 2B).
// The parser and the server translations stay internal; this exposes only the plain values the mail engine needs to
// build its IMAP query: the criteria, the `in:` folder hints and the `account:` filters.

import FlintModel
import Foundation

public struct RemoteSearchRequest: Hashable, Sendable {
    public var from: String?
    public var to: String?
    public var cc: String?
    public var subject: String?
    public var text: String?
    public var seen: Bool?
    public var flagged: Bool?
    /// Epoch ms at local midnight (inclusive).
    public var sinceMs: EpochMs?
    /// Epoch ms at local midnight (exclusive).
    public var beforeMs: EpochMs?
    /// Lower-case mailbox roles named by `in:`.
    public var roles: [String]
    /// Lower-case user folder names named by `in:`.
    public var names: [String]
    /// Lower-case values of the positive `account:` filters (an address or an id).
    public var accounts: [String]
    /// Gmail's X-GM-RAW form of the same query, for transports that can send it.
    public var gmailRaw: String?

    /// True when there is nothing to ask the server.
    public var isEmpty: Bool {
        from == nil && to == nil && cc == nil && subject == nil && text == nil && seen == nil && flagged == nil
            && sinceMs == nil && beforeMs == nil
    }
}

public enum RemoteSearch {
    public static func request(for search: String, calendar: Calendar = .current) -> RemoteSearchRequest {
        let parsed = SearchParser.parse(search, calendar: calendar)
        let criteria = SearchServer.imapCriteria(parsed) ?? ImapSearchCriteria()
        let targets = SearchServer.inTargets(parsed)
        return RemoteSearchRequest(
            from: criteria.from, to: criteria.to, cc: criteria.cc, subject: criteria.subject, text: criteria.text,
            seen: criteria.seen, flagged: criteria.flagged, sinceMs: criteria.since, beforeMs: criteria.before,
            roles: targets.roles, names: targets.names,
            accounts: parsed.account.filter { !$0.negated }.map { $0.value.lowercased() },
            gmailRaw: SearchServer.gmailRaw(parsed, calendar: calendar))
    }
}
