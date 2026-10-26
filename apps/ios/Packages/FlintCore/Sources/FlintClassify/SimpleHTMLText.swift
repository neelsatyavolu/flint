import Foundation

/// Minimal HTML to text for code detection, so FlintClassify does not need an HTML parser. Drops script, style, head,
/// title and comments, turns block tags into line breaks (paragraph-like tags into a blank line, as the desktop's
/// html-to-text does), strips the remaining tags and decodes common entities. The service facade may pass the
/// FlintHTML converter to `CodeDetector` instead.
enum SimpleHTMLText {
    private static let comments = JSRegex(literal: #"<!--[\s\S]*?-->"#)
    private static let skipped = JSRegex(literal: #"<(script|style|head|title)\b[^>]*>[\s\S]*?</\1\s*>"#, ignoreCase: true)
    private static let whitespace = JSRegex(literal: #"\s+"#)
    private static let lineBreak = JSRegex(literal: #"<br\b[^>]*>|</?(?:div|li|tr)\b[^>]*>"#, ignoreCase: true)
    private static let blankLine = JSRegex(literal: #"</?(?:p|h[1-6]|blockquote|ul|ol|table|pre)\b[^>]*>"#, ignoreCase: true)
    private static let cellEnd = JSRegex(literal: #"</t[dh]\s*>"#, ignoreCase: true)
    private static let tags = JSRegex(literal: #"<[^>]*>"#)
    private static let entity = JSRegex(literal: #"&(#x[0-9a-f]+|#[0-9]+|[a-z]+);"#, ignoreCase: true)
    private static let spaceRuns = JSRegex(literal: #"[ \t ]+"#)
    private static let manyBlank = JSRegex(literal: #"\n{3,}"#)

    private static let named: [String: String] = [
        "nbsp": " ", "amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'", "ndash": "\u{2013}", "mdash": "\u{2014}",
        "lsquo": "\u{2018}", "rsquo": "\u{2019}", "ldquo": "\u{201C}", "rdquo": "\u{201D}",
    ]

    static func convert(_ html: String) -> String {
        var s = comments.replacing(in: html, with: "")
        s = skipped.replacing(in: s, with: " ")
        s = whitespace.replacing(in: s, with: " ")
        s = lineBreak.replacing(in: s, with: "\n")
        s = blankLine.replacing(in: s, with: "\n\n")
        s = cellEnd.replacing(in: s, with: " ")
        s = tags.replacing(in: s, with: "")
        s = decode(s)
        let lines = s.components(separatedBy: "\n").map {
            spaceRuns.replacing(in: $0, with: " ").trimmingCharacters(in: .whitespaces)
        }
        return manyBlank.replacing(in: lines.joined(separator: "\n"), with: "\n\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func decode(_ s: String) -> String {
        guard s.contains("&") else { return s }
        var out = ""
        var last = s.startIndex
        let ns = s as NSString
        for m in entity.all(in: s) {
            let range = m.result.range
            guard let r = Range(range, in: s), let body = m[1] else { continue }
            out += s[last..<r.lowerBound]
            last = r.upperBound
            if body.hasPrefix("#x") || body.hasPrefix("#X") {
                out += UInt32(body.dropFirst(2), radix: 16).flatMap(Unicode.Scalar.init).map { String(Character($0)) } ?? ns.substring(with: range)
            } else if body.hasPrefix("#") {
                out += UInt32(body.dropFirst(1)).flatMap(Unicode.Scalar.init).map { String(Character($0)) } ?? ns.substring(with: range)
            } else {
                out += named[body.lowercased()] ?? ns.substring(with: range)
            }
        }
        out += s[last...]
        return out
    }
}
