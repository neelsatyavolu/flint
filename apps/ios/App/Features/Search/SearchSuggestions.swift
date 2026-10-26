import FlintModel
import Foundation

/// One tappable line above the results. `replacement` is the whole field text after choosing it.
struct SearchSuggestion: Identifiable, Hashable, Sendable {
    enum Kind: Hashable, Sendable { case op, value, person }

    let kind: Kind
    let title: String
    let detail: String
    let replacement: String
    var id: String { "\(kind).\(replacement)" }
}

enum SearchSuggestions {
    static let folderValues = ["inbox", "sent", "drafts", "archive", "trash", "spam"]
    static let limit = 6

    /// The address prefix to look up in contacts for the word being typed, with the operator it will fill: `from:ma` and a bare
    /// `ma` both mean a sender, `to:ma` a recipient.
    static func contactLookup(for input: String) -> (key: String, prefix: String)? {
        let word = SearchText.lastWord(input)
        if let colon = word.firstIndex(of: ":") {
            let key = word[..<colon].lowercased()
            let value = String(word[word.index(after: colon)...])
            guard key == "from" || key == "to", !value.isEmpty, !value.hasPrefix("\"") else { return nil }
            return (key, value)
        }
        guard word.count >= 2, !word.hasPrefix("\""), !word.hasPrefix("-") else { return nil }
        return ("from", word)
    }

    /// Operator, value and person suggestions for the word being typed. Empty when the input is empty (the screen shows recents).
    static func make(for input: String, contacts: [Contact]) -> [SearchSuggestion] {
        let word = SearchText.lastWord(input)
        guard !word.isEmpty else { return [] }
        var out = operatorSuggestions(word: word, input: input)
        out += valueSuggestions(word: word, input: input)
        if let lookup = contactLookup(for: input) {
            out += contacts.map { person(lookup.key, $0, input: input) }
        }
        return Array(out.prefix(limit))
    }

    private static func operatorSuggestions(word: String, input: String) -> [SearchSuggestion] {
        let lower = word.lowercased()
        return SearchOperator.all
            .filter { $0.token.hasPrefix(lower) && $0.token != lower }
            .map { op in
                SearchSuggestion(
                    kind: .op, title: op.token, detail: op.hint,
                    replacement: SearchText.replacingLastWord(in: input, with: op.token) + (op.isComplete ? " " : ""))
            }
    }

    private static func valueSuggestions(word: String, input: String) -> [SearchSuggestion] {
        let lower = word.lowercased()
        guard lower.hasPrefix("in:") else { return [] }
        let typed = String(lower.dropFirst(3))
        return folderValues.filter { $0.hasPrefix(typed) && $0 != typed }.map { value in
            SearchSuggestion(
                kind: .value, title: "in:\(value)", detail: "",
                replacement: SearchText.replacingLastWord(in: input, with: "in:\(value) "))
        }
    }

    private static func person(_ key: String, _ contact: Contact, input: String) -> SearchSuggestion {
        SearchSuggestion(
            kind: .person, title: contact.name.isEmpty ? contact.email : contact.name, detail: contact.email,
            replacement: SearchText.replacingLastWord(in: input, with: "\(key):\(contact.email) "))
    }
}
