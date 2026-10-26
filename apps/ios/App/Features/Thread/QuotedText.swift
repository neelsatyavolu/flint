import Foundation

/// Splits a reply into what the sender wrote and the quoted history behind it. Ported from the desktop `quotedText.ts`.
/// The HTML half cuts at the first known marker (Gmail, Apple Mail, Outlook) instead of walking a DOM, because the reader
/// has no HTML parser outside the web view.
enum QuotedText {
    struct Plain: Equatable {
        var body: String
        var quoted: String
    }

    struct HTMLParts: Equatable {
        var body: String
        /// Nil when nothing is clearly quoted.
        var quoted: String?
    }

    private static let attribution = #"^(on .{5,200} wrote:|-{2,}\s*original message\s*-{2,}|-{2,}\s*forwarded message\s*-{2,})\s*$"#
    private static let originalMessage = #"^-{2,}\s*original message\s*-{2,}$"#
    private static let outlookHeader = #"^\s*from:[\s\S]{1,300}?(sent|date):"#
    private static let forwardSubject = #"^\s*(fwd?|fw)\s*:"#

    static func splitPlain(_ text: String) -> Plain {
        let lines = text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        guard let start = quoteStart(in: lines), start > 0 else { return Plain(body: text, quoted: "") }
        let body = lines[..<start].joined(separator: "\n").replacingOccurrences(of: #"\s+$"#, with: "", options: .regularExpression)
        if body.isEmpty { return Plain(body: text, quoted: "") }
        let quoted = lines[start...].joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        return Plain(body: body, quoted: quoted)
    }

    private static func quoteStart(in lines: [String]) -> Int? {
        for (index, line) in lines.enumerated() {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            let nextFilled = lines[(index + 1)...].first { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
            let isAttribution = matches(attribution, trimmed) && (nextFilled?.hasPrefix(">") ?? false)
            let window = lines[index..<min(index + 5, lines.count)].joined(separator: "\n")
            let isOutlook = matches(originalMessage, trimmed) || (trimmed.lowercased().hasPrefix("from:") && matches(outlookHeader, window))
            if line.hasPrefix(">") || isAttribution || isOutlook { return index }
        }
        return nil
    }

    private static let htmlMarkers = [
        #"<(?:div|blockquote)\b[^>]*\bclass\s*=\s*["'][^"']*\bgmail_quote\b"#,
        #"<blockquote\b[^>]*\btype\s*=\s*["']cite["']"#,
        #"<div\b[^>]*\bid\s*=\s*["'](?:divRplyFwdMsg|appendonsend)["']"#,
        #"<(?:div|p|span)\b[^>]*>\s*(?:<[^>]+>\s*)*On\s[^<]{5,200}wrote:"#,
    ]
    private static let wroteTail = #"<(?:div|p|span)\b[^>]*>\s*(?:<[^>]+>\s*)*On\s[^<]{5,200}wrote:\s*(?:<[^>]*>\s*)*$"#

    static func splitHTML(_ html: String, subject: String = "") -> HTMLParts {
        let whole = HTMLParts(body: html, quoted: nil)
        if matches(forwardSubject, subject) { return whole }
        guard var cut = firstMarker(in: html) else { return whole }
        if let tail = html[..<cut].range(of: wroteTail, options: [.regularExpression, .caseInsensitive]) { cut = tail.lowerBound }
        let body = String(html[..<cut])
        guard hasVisibleContent(body) else { return whole }
        return HTMLParts(body: body, quoted: headStyles(of: html) + String(html[cut...]))
    }

    private static func firstMarker(in html: String) -> String.Index? {
        var found: String.Index?
        for marker in htmlMarkers {
            var from = html.startIndex
            while let range = html.range(of: marker, options: [.regularExpression, .caseInsensitive], range: from..<html.endIndex) {
                let after = html[range.upperBound...].prefix(300)
                if after.range(of: "forwarded message", options: .caseInsensitive) == nil {
                    if let current = found { found = min(current, range.lowerBound) } else { found = range.lowerBound }
                    break
                }
                from = range.upperBound
            }
        }
        return found
    }

    private static func hasVisibleContent(_ html: String) -> Bool {
        let text = html.replacingOccurrences(of: #"<style[\s\S]*?</style>|<[^>]+>|&nbsp;"#, with: " ", options: [.regularExpression, .caseInsensitive])
        if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return true }
        return html.range(of: #"<(img|table|video)\b"#, options: [.regularExpression, .caseInsensitive]) != nil
    }

    /// The mail's own `<style>` blocks, so the quoted half keeps its look.
    private static func headStyles(of html: String) -> String {
        guard let head = html.range(of: #"<head[\s\S]*?</head>"#, options: [.regularExpression, .caseInsensitive]) else { return "" }
        var styles = ""
        var from = head.lowerBound
        while let style = html.range(of: #"<style[\s\S]*?</style>"#, options: [.regularExpression, .caseInsensitive], range: from..<head.upperBound) {
            styles += html[style]
            from = style.upperBound
        }
        return styles
    }

    private static func matches(_ pattern: String, _ text: String) -> Bool {
        text.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
    }
}
