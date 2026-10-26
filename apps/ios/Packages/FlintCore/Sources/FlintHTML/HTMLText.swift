import Foundation
import SwiftSoup

/// Plain text from HTML for snippets and search text (port of sanitize/htmlToText.ts, simplified: headings keep
/// their case and tables are one row per line).
public enum HTMLText {
    private static let skipped: Set<String> = ["img", "style", "script", "head", "title", "noscript", "template"]
    private static let blocks: Set<String> = [
        "p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "table", "blockquote", "pre", "section", "article", "header",
        "footer", "nav", "aside", "figure", "figcaption", "address", "dl", "main", "details", "summary", "center",
    ]
    private static let maxDepth = 200

    public static func htmlToText(_ html: String, wordwrap: Int? = nil) -> String {
        guard !html.isEmpty, let doc = try? SwiftSoup.parse(html) else { return "" }
        var writer = TextWriter()
        convert(doc, &writer, depth: 0, preformatted: false, listNumber: nil)
        var text = writer.out
        text = text.replacingOccurrences(of: #"[ \t]+\n"#, with: "\n", options: .regularExpression)
        text = text.replacingOccurrences(of: #"\n{3,}"#, with: "\n\n", options: .regularExpression)
        text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let wordwrap, wordwrap > 0 { text = wrap(text, width: wordwrap) }
        return text
    }

    /// One-line preview of a body, whitespace collapsed and cut at a word boundary.
    public static func snippet(from text: String, max: Int = 140) -> String {
        let flat = text.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        let units = Array(flat.utf16)
        if units.count <= max { return flat }
        var cut = Array(units[0..<max])
        if let last = cut.last, UTF16.isLeadSurrogate(last) { cut.removeLast() }
        if let space = cut.lastIndex(of: 0x20), Double(space) > Double(max) * 0.6 { cut = Array(cut[0..<space]) }
        let kept = String(decoding: cut, as: UTF16.self).trimmingCharacters(in: .whitespacesAndNewlines)
        return kept + "\u{2026}"
    }

    // MARK: - Conversion

    private struct TextWriter {
        var out = ""

        mutating func ensureBreak(_ newlines: Int) {
            guard !out.isEmpty else { return }
            var have = 0
            for ch in out.reversed() { if ch == "\n" { have += 1 } else { break } }
            if have < newlines { out += String(repeating: "\n", count: newlines - have) }
        }

        mutating func append(_ text: String, preformatted: Bool) {
            if preformatted { out += text; return }
            var pendingSpace = false
            for ch in text {
                if ch.isWhitespace && ch != "\u{00A0}" {
                    pendingSpace = true
                } else {
                    if pendingSpace, let last = out.last, last != "\n", last != " " { out.append(" ") }
                    pendingSpace = false
                    out.append(ch)
                }
            }
            if pendingSpace, let last = out.last, last != "\n", last != " " { out.append(" ") }
        }
    }

    private static func convert(_ node: Node, _ w: inout TextWriter, depth: Int, preformatted: Bool, listNumber: Int?) {
        if let text = node as? TextNode {
            w.append(text.getWholeText(), preformatted: preformatted)
            return
        }
        guard let element = node as? Element else { return }
        let tag = element.tagNameNormal()
        if skipped.contains(tag) { return }
        if depth > maxDepth {
            w.append((try? element.text()) ?? "", preformatted: false)
            return
        }
        switch tag {
        case "br":
            w.out += "\n"
        case "hr":
            w.ensureBreak(1)
            w.out += "-----\n"
        case "ul", "ol":
            w.ensureBreak(2)
            var n = 1
            for child in element.getChildNodes() {
                convert(child, &w, depth: depth + 1, preformatted: preformatted, listNumber: tag == "ol" ? n : 0)
                if let el = child as? Element, el.tagNameNormal() == "li" { n += 1 }
            }
            w.ensureBreak(2)
        case "li":
            w.ensureBreak(1)
            w.out += (listNumber ?? 0) > 0 ? "\(listNumber!). " : "* "
            for child in element.getChildNodes() { convert(child, &w, depth: depth + 1, preformatted: preformatted, listNumber: nil) }
            w.ensureBreak(1)
        case "tr":
            w.ensureBreak(1)
            var cells: [String] = []
            for child in element.getChildNodes() {
                guard let cell = child as? Element, ["td", "th"].contains(cell.tagNameNormal()) else { continue }
                var inner = TextWriter()
                convert(cell, &inner, depth: depth + 1, preformatted: preformatted, listNumber: nil)
                let text = inner.out.trimmingCharacters(in: .whitespacesAndNewlines)
                if !text.isEmpty { cells.append(text) }
            }
            w.out += cells.joined(separator: "  ")
            w.ensureBreak(1)
        case "a":
            let start = w.out.count
            for child in element.getChildNodes() { convert(child, &w, depth: depth + 1, preformatted: preformatted, listNumber: nil) }
            let label = String(w.out.dropFirst(start)).trimmingCharacters(in: .whitespacesAndNewlines)
            if let href = linkTarget((try? element.attr("href")) ?? ""), href != label { w.out += " (\(href))" }
        default:
            let isBlock = blocks.contains(tag)
            if isBlock { w.ensureBreak(2) }
            let pre = preformatted || tag == "pre"
            for child in element.getChildNodes() { convert(child, &w, depth: depth + 1, preformatted: pre, listNumber: nil) }
            if isBlock { w.ensureBreak(2) }
        }
    }

    private static func linkTarget(_ raw: String) -> String? {
        let href = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if href.isEmpty || href.hasPrefix("#") { return nil }
        if href.lowercased().hasPrefix("javascript:") { return nil }
        if href.lowercased().hasPrefix("mailto:") { return String(href.dropFirst(7)) }
        return href
    }

    private static func wrap(_ text: String, width: Int) -> String {
        text.split(separator: "\n", omittingEmptySubsequences: false).map { line -> String in
            var lines: [String] = []
            var current = ""
            for word in line.split(separator: " ", omittingEmptySubsequences: true) {
                var piece = String(word)
                while piece.count > width {
                    if !current.isEmpty { lines.append(current); current = "" }
                    lines.append(String(piece.prefix(width)))
                    piece = String(piece.dropFirst(width))
                }
                if current.isEmpty { current = piece } else if current.count + 1 + piece.count <= width { current += " " + piece } else {
                    lines.append(current)
                    current = piece
                }
            }
            lines.append(current)
            return lines.joined(separator: "\n")
        }.joined(separator: "\n")
    }
}
