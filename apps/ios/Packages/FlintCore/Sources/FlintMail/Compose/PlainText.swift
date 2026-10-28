// A readable plain-text alternative for an HTML body: block tags become line breaks, tags are dropped, entities decoded.

import Foundation

public enum PlainText {
    private static let entities: [String: String] = [
        "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'", "&apos;": "'", "&hellip;": "...", "&mdash;": "-", "&ndash;": "-",
    ]

    public static func fromHTML(_ html: String) -> String {
        var text = html
        func replace(_ pattern: String, _ template: String) {
            text = text.replacingOccurrences(of: pattern, with: template, options: [.regularExpression, .caseInsensitive])
        }
        replace(#"(?s)<(script|style|head)\b[^>]*>.*?</\1>"#, "")
        replace(#"<br\s*/?>"#, "\n")
        replace(#"</(p|div|h[1-6]|li|tr|blockquote|table)>"#, "\n")
        replace(#"<li\b[^>]*>"#, "- ")
        replace(#"<[^>]+>"#, "")
        for (entity, value) in entities { text = text.replacingOccurrences(of: entity, with: value) }
        text = decodeNumericEntities(text)
        let lines = text.replacingOccurrences(of: "\r", with: "").components(separatedBy: "\n").map { $0.trimmingCharacters(in: .whitespaces) }
        var out: [String] = []
        for line in lines {
            if line.isEmpty, out.last?.isEmpty ?? true { continue }
            out.append(line)
        }
        return out.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func decodeNumericEntities(_ text: String) -> String {
        guard text.contains("&#"), let regex = try? NSRegularExpression(pattern: #"&#(x[0-9a-fA-F]+|[0-9]+);"#) else { return text }
        var result = text
        for match in regex.matches(in: text, range: NSRange(text.startIndex..., in: text)).reversed() {
            guard let whole = Range(match.range, in: result), let inner = Range(match.range(at: 1), in: result) else { continue }
            let token = result[inner]
            let value = token.hasPrefix("x") ? UInt32(token.dropFirst(), radix: 16) : UInt32(token)
            if let value, let scalar = UnicodeScalar(value) { result.replaceSubrange(whole, with: String(Character(scalar))) }
        }
        return result
    }
}
