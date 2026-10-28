// Plain text for the search index and snippets. Mirrors store/fts.ts; the HTML to text step is a light tag
// stripper because FlintStore does not depend on the HTML package. It only feeds the index and previews.

import Foundation

enum PlainText {
    static let bodyIndexCap = 100_000
    private static let htmlInputCap = 1_000_000
    private static let snippetChars = 140

    /// Converts HTML to readable text: drops style, script and images, turns block tags into line breaks, decodes entities.
    static func fromHTML(_ html: String) -> String {
        var s = String(html.prefix(htmlInputCap))
        s = s.replacingOccurrences(of: "<!--[\\s\\S]*?-->", with: " ", options: .regularExpression)
        for tag in ["style", "script", "head"] {
            s = s.replacingOccurrences(of: "<\(tag)\\b[^>]*>[\\s\\S]*?</\(tag)\\s*>", with: " ", options: [.regularExpression, .caseInsensitive])
        }
        s = s.replacingOccurrences(of: "<br\\s*/?>|</(p|div|li|tr|h[1-6]|blockquote|table)\\s*>", with: "\n", options: [.regularExpression, .caseInsensitive])
        s = s.replacingOccurrences(of: "<[^>]*>", with: " ", options: .regularExpression)
        return decodeEntities(s)
    }

    /// Text for the search index: the text part, else the HTML converted to text, capped at 100 KB.
    static func bodyText(text: String?, html: String?) -> String {
        let raw: String
        if let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { raw = text }
        else if let html { raw = fromHTML(html) }
        else { raw = "" }
        return String(raw.prefix(bodyIndexCap))
    }

    static func snippet(from body: String) -> String {
        String(collapse(body).prefix(200))
    }

    /// Preview of a draft body, whitespace collapsed.
    static func draftSnippet(html: String) -> String {
        String(collapse(fromHTML(html)).prefix(snippetChars))
    }

    private static func collapse(_ text: String) -> String {
        text.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }

    private static let named: [String: String] = [
        "amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'", "nbsp": " ", "ndash": "-", "mdash": "-", "hellip": "...",
        "rsquo": "'", "lsquo": "'", "rdquo": "\"", "ldquo": "\"", "copy": "(c)",
    ]

    private static func decodeEntities(_ text: String) -> String {
        guard text.contains("&") else { return text }
        var out = ""
        var i = text.startIndex
        while i < text.endIndex {
            guard text[i] == "&", let semi = text[i...].prefix(12).firstIndex(of: ";") else {
                out.append(text[i])
                i = text.index(after: i)
                continue
            }
            let name = String(text[text.index(after: i)..<semi])
            if let value = decode(name) {
                out.append(value)
                i = text.index(after: semi)
            } else {
                out.append(text[i])
                i = text.index(after: i)
            }
        }
        return out
    }

    private static func decode(_ name: String) -> String? {
        if name.hasPrefix("#") {
            let digits = name.dropFirst()
            let code = digits.hasPrefix("x") || digits.hasPrefix("X") ? UInt32(digits.dropFirst(), radix: 16) : UInt32(digits)
            return code.flatMap(Unicode.Scalar.init).map { String(Character($0)) }
        }
        return named[name.lowercased()]
    }
}
