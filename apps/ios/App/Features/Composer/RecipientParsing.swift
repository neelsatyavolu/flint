import FlintModel
import Foundation

/// Typed or pasted recipients, ported from the desktop `recipients.ts`.
enum RecipientParsing {
    private static let email = try! NSRegularExpression(pattern: #"^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$"#)
    private static let angle = try! NSRegularExpression(pattern: #"^(.*?)<\s*([^<>\s]+)\s*>\s*$"#)

    struct Parsed: Equatable {
        var addresses: [Address]
        var invalid: [String]
    }

    static func isValidEmail(_ value: String) -> Bool {
        let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return email.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
    }

    /// Splits on commas, semicolons and newlines outside quotes and angle brackets.
    static func tokens(_ input: String) -> [String] {
        var out: [String] = []
        var current = ""
        var inQuote = false
        var inAngle = false
        for ch in input {
            if ch == "\"" { inQuote.toggle() } else if !inQuote, ch == "<" { inAngle = true } else if !inQuote, ch == ">" { inAngle = false }
            if !inQuote, !inAngle, ch == "," || ch == ";" || ch == "\n" || ch == "\r" {
                out.append(current)
                current = ""
            } else {
                current.append(ch)
            }
        }
        out.append(current)
        return out.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }

    /// One token: `a@b.co`, `<a@b.co>`, `Name <a@b.co>`, `"Last, First" <a@b.co>`.
    static func parseAddress(_ token: String) -> Address? {
        let text = token.trimmingCharacters(in: .whitespacesAndNewlines)
        let range = NSRange(text.startIndex..., in: text)
        if let match = angle.firstMatch(in: text, range: range),
            let nameRange = Range(match.range(at: 1), in: text), let addressRange = Range(match.range(at: 2), in: text) {
            let address = String(text[addressRange]).trimmingCharacters(in: .whitespaces)
            guard isValidEmail(address) else { return nil }
            var name = String(text[nameRange]).trimmingCharacters(in: .whitespaces)
            if name.count >= 2, name.hasPrefix("\""), name.hasSuffix("\"") { name = String(name.dropFirst().dropLast()) }
            return Address(name: name.replacingOccurrences(of: "\\\"", with: "\"").trimmingCharacters(in: .whitespaces), address: address)
        }
        return isValidEmail(text) ? Address(name: "", address: text) : nil
    }

    static func parseList(_ input: String) -> Parsed {
        var result = Parsed(addresses: [], invalid: [])
        for token in tokens(input) {
            if let parsed = parseAddress(token) { result.addresses.append(parsed) } else { result.invalid.append(token) }
        }
        return result
    }

    /// `list` plus `add`, skipping addresses already present (case-insensitive).
    static func merged(_ list: [Address], with add: [Address]) -> [Address] {
        var seen = Set(list.map { $0.address.lowercased() })
        var next = list
        for address in add where seen.insert(address.address.lowercased()).inserted { next.append(address) }
        return next
    }

    static func removing(_ address: String, from list: [Address]) -> [Address] {
        list.filter { $0.address.caseInsensitiveCompare(address) != .orderedSame }
    }
}
