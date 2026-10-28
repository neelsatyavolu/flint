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
        let body = trimmingTrailingWhitespace(lines[..<start].joined(separator: "\n"))
        if body.isEmpty { return Plain(body: text, quoted: "") }
        let quoted = lines[start...].joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        return Plain(body: body, quoted: quoted)
    }

    /// `\s+$` as a regex is quadratic on a long whitespace run in the middle of the text, so the tail is trimmed by hand.
    private static func trimmingTrailingWhitespace(_ text: String) -> String {
        var end = text.endIndex
        while end > text.startIndex, text[text.index(before: end)].isWhitespace { end = text.index(before: end) }
        return String(text[..<end])
    }

    /// The first line that starts quoted history. Everything that looks ahead (the line after an attribution, the Outlook header
    /// window) runs only for lines that can start one, so blank runs cost one pass.
    private static func quoteStart(in lines: [String]) -> Int? {
        for (index, line) in lines.enumerated() {
            if line.hasPrefix(">") { return index }
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty { continue }
            if matches(attribution, trimmed), nextFilledLine(after: index, in: lines)?.hasPrefix(">") == true { return index }
            if matches(originalMessage, trimmed) { return index }
            if trimmed.lowercased().hasPrefix("from:"), matches(outlookHeader, lines[index..<min(index + 5, lines.count)].joined(separator: "\n")) {
                return index
            }
        }
        return nil
    }

    private static func nextFilledLine(after index: Int, in lines: [String]) -> String? {
        lines[(index + 1)...].first { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
    }

    /// Markers that one bounded pattern finds. The "On ... wrote:" line is found separately (see `firstAttribution`), because a
    /// pattern that allows any run of tags before it re-scans that run from every `<div>`.
    private static let htmlMarkers = [
        #"<(?:div|blockquote)\b[^>]*\bclass\s*=\s*["'][^"']*\bgmail_quote\b"#,
        #"<blockquote\b[^>]*\btype\s*=\s*["']cite["']"#,
        #"<div\b[^>]*\bid\s*=\s*["'](?:divRplyFwdMsg|appendonsend)["']"#,
    ]
    private static let wroteLine = #"On\s[^<]{5,200}wrote:"#
    private static let wroteLineAtEnd = wroteLine + "$"

    static func splitHTML(_ html: String, subject: String = "") -> HTMLParts {
        let whole = HTMLParts(body: html, quoted: nil)
        if matches(forwardSubject, subject) { return whole }
        let units = Array(html.utf16)
        guard var cut = firstMarker(in: html, units: units) else { return whole }
        if let tail = attributionStart(endingAt: cut.utf16Offset(in: html), in: units) { cut = String.Index(utf16Offset: tail, in: html) }
        let body = String(html[..<cut])
        guard hasVisibleContent(body) else { return whole }
        return HTMLParts(body: body, quoted: headStyles(of: html) + String(html[cut...]))
    }

    private static func firstMarker(in html: String, units: [UInt16]) -> String.Index? {
        var found = firstAttribution(in: html, units: units)
        for marker in htmlMarkers {
            var from = html.startIndex
            while let range = html.range(of: marker, options: [.regularExpression, .caseInsensitive], range: from..<html.endIndex) {
                if !isForward(after: range.upperBound, in: html) {
                    if let current = found { found = min(current, range.lowerBound) } else { found = range.lowerBound }
                    break
                }
                from = range.upperBound
            }
        }
        return found
    }

    private static func isForward(after index: String.Index, in html: String) -> Bool {
        html[index...].prefix(300).range(of: "forwarded message", options: .caseInsensitive) != nil
    }

    // MARK: Attribution line ("On ... wrote:")

    /// Start of the first "On ... wrote:" line that sits in a `<div>`, `<p>` or `<span>` (with nothing but tags between), unless a
    /// forwarded message follows it. Candidates are found by their text and the tag run is read backwards from there, so the cost
    /// is linear in the mail instead of quadratic in the length of a tag run.
    private static func firstAttribution(in html: String, units: [UInt16]) -> String.Index? {
        guard let regex = try? NSRegularExpression(pattern: wroteLine, options: .caseInsensitive) else { return nil }
        var found: String.Index?
        regex.enumerateMatches(in: html, range: NSRange(location: 0, length: units.count)) { match, _, stop in
            guard let range = match?.range, let start = blockChainStart(before: range.location, in: units) else { return }
            if isForward(after: String.Index(utf16Offset: range.location + range.length, in: html), in: html) { return }
            found = String.Index(utf16Offset: start, in: html)
            stop.pointee = true
        }
        return found
    }

    /// Where the attribution line that ends right before `cut` (only tags and blanks between) starts, if there is one.
    private static func attributionStart(endingAt cut: Int, in units: [UInt16]) -> Int? {
        var end = cut
        while true {
            while end > 0, isBlank(units[end - 1]) { end -= 1 }
            guard end > 0, units[end - 1] == Mark.close, let open = tagStart(endingAt: end - 1, in: units) else { break }
            end = open
        }
        // The attribution text is at most ~215 units, and cannot contain "<".
        var from = max(0, end - 260)
        if let lt = units[from..<end].lastIndex(of: Mark.open) { from = lt + 1 }
        let window = String(decoding: units[from..<end], as: UTF16.self)
        guard let range = window.range(of: wroteLineAtEnd, options: [.regularExpression, .caseInsensitive]) else { return nil }
        let on = from + window.utf16.distance(from: window.startIndex, to: range.lowerBound)
        return blockChainStart(before: on, in: units)
    }

    /// Walks back from `position` over blanks and tags. Returns where the earliest opening `<div>`, `<p>` or `<span>` of that
    /// run starts, or nil when the run has none.
    private static func blockChainStart(before position: Int, in units: [UInt16]) -> Int? {
        var index = position
        var earliest: Int?
        while true {
            while index > 0, isBlank(units[index - 1]) { index -= 1 }
            guard index > 0, units[index - 1] == Mark.close, let open = tagStart(endingAt: index - 1, in: units) else { break }
            if opensBlock(units, from: open) { earliest = open }
            index = open
        }
        return earliest
    }

    private enum Mark {
        static let open = UInt16(UInt8(ascii: "<"))
        static let close = UInt16(UInt8(ascii: ">"))
    }

    private static func isBlank(_ unit: UInt16) -> Bool { unit == 0x20 || (0x09...0x0D).contains(unit) || unit == 0xA0 }

    /// The `<` of the tag whose `>` is at `close`, or nil when a `>` comes first or the tag would be absurdly long.
    private static func tagStart(endingAt close: Int, in units: [UInt16]) -> Int? {
        var index = close - 1
        let floor = max(0, close - 4096)
        while index >= floor {
            if units[index] == Mark.open { return index < close - 1 ? index : nil }
            if units[index] == Mark.close { return nil }
            index -= 1
        }
        return nil
    }

    /// True for `<div ...>`, `<p ...>` and `<span ...>`, whatever the case.
    private static func opensBlock(_ units: [UInt16], from open: Int) -> Bool {
        var index = open + 1
        var name = ""
        while index < units.count, let scalar = Unicode.Scalar(units[index]), scalar.properties.isAlphabetic, name.count < 5 {
            name.unicodeScalars.append(scalar)
            index += 1
        }
        guard ["div", "p", "span"].contains(name.lowercased()), index < units.count else { return false }
        let next = units[index]
        let isWordChar = (next >= 0x30 && next <= 0x39) || (next >= 0x41 && next <= 0x5A) || (next >= 0x61 && next <= 0x7A) || next == 0x5F
        return !isWordChar
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
