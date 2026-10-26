import Foundation
import FlintModel

/// Bump when `Categorizer.categorize` changes so existing mail is re-labelled once. Matches `CATEGORIZER_VERSION`
/// in `packages/core/src/categorize/index.ts` and `meta.version` of `fixtures/categorize.json`.
public let categorizerVersion = 2

public struct CategorizeInput: Sendable {
    public var from: Address?
    /// Lowercase header names.
    public var headers: [String: String]
    /// True when the sender is the user or a contact the user has written to (sent_count > 0).
    public var isKnownContact: Bool
    public var subject: String?

    public init(from: Address?, headers: [String: String] = [:], isKnownContact: Bool = false, subject: String? = nil) {
        self.from = from
        self.headers = headers
        self.isKnownContact = isKnownContact
        self.subject = subject
    }
}

/// SPEC section 4. Known contacts are always people. Then transactional streams (notifications), marketing lists
/// (newsletters), and bulk senders without list headers (notifications). Everything else is people.
public enum Categorizer {
    private static let bulkPrecedence = JSRegex(literal: #"^(bulk|list|junk)\z"#)
    private static let listIdStrip = JSRegex(literal: #"[<>\s]"#)

    private static func header(_ headers: [String: String], _ name: String) -> String {
        (headers[name] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    public static func categorize(_ input: CategorizeInput) -> MailCategory {
        if input.isKnownContact { return .people }
        let headers = input.headers
        let address = (input.from?.address ?? "").lowercased()
        // Like JS split("@"): local is the first part, domain the second (text after a second "@" is dropped).
        let allParts = address.components(separatedBy: "@")
        let local = allParts.first ?? ""
        let domain = allParts.count > 1 ? allParts[1] : ""
        let listId = header(headers, "list-id").lowercased()
        let hasList = header(headers, "list-unsubscribe") != "" || listId != "" || header(headers, "list-post") != ""
        let transactionalSubject = Signals.transactionalSubject.test(input.subject ?? "")

        if Signals.hasTransactionalHeader(headers) { return .notifications }
        if Signals.alwaysNotifyDomain.test(domain) || Signals.alwaysNotifyDomain.test(listIdStrip.replacing(in: listId, with: "")) { return .notifications }

        let esp = Signals.hasEspSignature(headers)
        let bulk = hasList || esp || bulkPrecedence.test(header(headers, "precedence").lowercased())
        let label = Signals.subdomainClass(domain)
        let strongLocal = Signals.strongLocal.test(local)
        let automated = strongLocal || label == .strong || (bulk && (Signals.weakLocal.test(local) || label == .weak))

        if Signals.mixedDomain.test(domain) { return transactionalSubject || !hasList ? .notifications : .newsletters }
        if transactionalSubject && (automated || bulk) { return .notifications }
        if label == .news { return .newsletters }
        if hasList { return label == .strong ? .notifications : .newsletters }
        if automated || bulk { return .notifications }
        return .people
    }

    public struct RollupMessage: Sendable {
        public var category: MailCategory?
        public var date: EpochMs
        public init(category: MailCategory?, date: EpochMs) {
            self.category = category
            self.date = date
        }
    }

    /// Thread category from its messages: any people message makes the thread people, otherwise the latest message decides.
    public static func rollupCategory(_ messages: [RollupMessage]) -> MailCategory {
        if messages.isEmpty { return .people }
        if messages.contains(where: { ($0.category ?? .people) == .people }) { return .people }
        // reduce keeps the later element on ties (>=), like the TypeScript.
        let latest = messages.dropFirst().reduce(messages[0]) { $1.date >= $0.date ? $1 : $0 }
        return latest.category ?? .people
    }
}
