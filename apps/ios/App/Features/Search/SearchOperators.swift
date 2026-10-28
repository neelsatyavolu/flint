import Foundation

/// One search operator, as the desktop's `searchHints.ts` lists them.
struct SearchOperator: Identifiable, Hashable, Sendable {
    let token: String
    let hint: String
    var id: String { token }
    /// `has:attachment` and friends stand alone; `from:` waits for a value.
    var isComplete: Bool { !token.hasSuffix(":") }

    static let all: [SearchOperator] = [
        SearchOperator(token: "from:", hint: String(localized: "Sender", table: "Search")),
        SearchOperator(token: "to:", hint: String(localized: "Recipient", table: "Search")),
        SearchOperator(token: "subject:", hint: String(localized: "Words in the subject", table: "Search")),
        SearchOperator(token: "has:attachment", hint: String(localized: "With attachments", table: "Search")),
        SearchOperator(token: "is:unread", hint: String(localized: "Unread only", table: "Search")),
        SearchOperator(token: "is:pinned", hint: String(localized: "Pinned only", table: "Search")),
        SearchOperator(token: "in:", hint: String(localized: "Inbox, sent, drafts, archive, trash", table: "Search")),
        SearchOperator(token: "before:", hint: String(localized: "Before a date, YYYY-MM-DD", table: "Search")),
        SearchOperator(token: "after:", hint: String(localized: "After a date, YYYY-MM-DD", table: "Search")),
        SearchOperator(token: "account:", hint: String(localized: "One account", table: "Search")),
    ]

    /// The operators shown as chips under the field.
    static let chips: [SearchOperator] = all.filter { $0.token != "account:" }
}

/// Pure text handling for the search field: which word is being typed, which operators are already in the query, and how a
/// chip or suggestion changes the text.
enum SearchText {
    /// The word being typed (after the last space).
    static func lastWord(_ input: String) -> String {
        input.split(separator: " ", omittingEmptySubsequences: false).last.map(String.init) ?? ""
    }

    static func replacingLastWord(in input: String, with word: String) -> String {
        String(input.dropLast(lastWord(input).count)) + word
    }

    /// Whole words of the query, quotes kept.
    static func words(_ input: String) -> [String] {
        input.split(whereSeparator: \.isWhitespace).map(String.init)
    }

    static func contains(_ token: String, in input: String) -> Bool {
        words(input).contains { $0.lowercased() == token }
    }

    static func removing(_ token: String, from input: String) -> String {
        let kept = words(input).filter { $0.lowercased() != token }
        return kept.joined(separator: " ") + (kept.isEmpty ? "" : " ")
    }

    /// Adds an operator at the end. A complete one gets a trailing space; one that waits for a value does not.
    static func appending(_ op: SearchOperator, to input: String) -> String {
        let head = input.isEmpty || input.hasSuffix(" ") ? input : input + " "
        return head + op.token + (op.isComplete ? " " : "")
    }

    /// Chip tap: standalone operators toggle, the others are added for the user to finish.
    static func toggling(_ op: SearchOperator, in input: String) -> String {
        if op.isComplete, contains(op.token, in: input) { return removing(op.token, from: input) }
        return appending(op, to: input)
    }

    /// True when the text carries something to search for.
    static func isSearchable(_ input: String) -> Bool {
        !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}
