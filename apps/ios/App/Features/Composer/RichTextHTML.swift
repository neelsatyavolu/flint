import Foundation

/// Converts the editor's `AttributedString` to the HTML and plain text that go out, and a draft's HTML back to an
/// `AttributedString`. The editor supports bold, italic, links and bulleted lists; a bullet is a line that starts with
/// `RichTextHTML.bullet`, which becomes a `<ul>` on the way out.
enum RichTextHTML {
    static let bullet = "• "

    struct Run: Equatable {
        var text: String
        var intent: InlinePresentationIntent
        var link: URL?
    }

    // MARK: Out

    /// The editor text as lines of runs.
    static func lines(_ text: AttributedString) -> [[Run]] {
        var lines: [[Run]] = [[]]
        for run in text.runs {
            let piece = String(text[run.range].characters)
            let parts = piece.split(separator: "\n", omittingEmptySubsequences: false)
            for (index, part) in parts.enumerated() {
                if index > 0 { lines.append([]) }
                if !part.isEmpty {
                    lines[lines.count - 1].append(Run(text: String(part), intent: run.inlinePresentationIntent ?? [], link: run.link))
                }
            }
        }
        return lines
    }

    private static func isBullet(_ line: [Run]) -> Bool { line.first?.text.hasPrefix(bullet) == true }

    private static func withoutBullet(_ line: [Run]) -> [Run] {
        guard var first = line.first else { return line }
        first.text.removeFirst(bullet.count)
        return (first.text.isEmpty ? [] : [first]) + line.dropFirst()
    }

    static func escape(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
    }

    private static func inline(_ runs: [Run]) -> String {
        runs.map { run in
            var html = escape(run.text)
            if run.intent.contains(.emphasized) { html = "<i>\(html)</i>" }
            if run.intent.contains(.stronglyEmphasized) { html = "<b>\(html)</b>" }
            if let link = run.link { html = "<a href=\"\(escape(link.absoluteString))\">\(html)</a>" }
            return html
        }.joined()
    }

    /// Blocks of `<div>` lines and `<ul>` lists. Empty when the text has nothing in it.
    static func html(from text: AttributedString) -> String {
        guard !isEmpty(text) else { return "" }
        var out = ""
        var openList = false
        for line in lines(text) {
            if isBullet(line) {
                if !openList { out += "<ul>"; openList = true }
                out += "<li>\(inline(withoutBullet(line)))</li>"
                continue
            }
            if openList { out += "</ul>"; openList = false }
            out += line.isEmpty ? "<div><br></div>" : "<div>\(inline(line))</div>"
        }
        if openList { out += "</ul>" }
        return out
    }

    /// One line per line; bullets stay as "• "; a link whose text differs from its address shows the address after it.
    static func plainText(from text: AttributedString) -> String {
        lines(text).map { line in
            line.map { run in
                guard let link = run.link, link.absoluteString != run.text else { return run.text }
                return "\(run.text) (\(link.absoluteString))"
            }.joined()
        }.joined(separator: "\n")
    }

    static func isEmpty(_ text: AttributedString) -> Bool {
        text.characters.allSatisfy { $0.isWhitespace || $0.isNewline }
    }

    // MARK: In

    private static let tokenPattern = try! NSRegularExpression(pattern: #"<[^>]*>|[^<]+"#)
    private static let hrefPattern = try! NSRegularExpression(pattern: #"href\s*=\s*(?:"([^"]*)"|'([^']*)')"#, options: .caseInsensitive)
    private static let blockTags: Set<String> = ["div", "p", "ul", "ol", "li", "blockquote", "h1", "h2", "h3", "tr"]

    private struct Builder {
        var result = AttributedString()
        var bold = 0
        var italic = 0
        var links: [URL?] = []
        var skipping = false

        var atLineStart: Bool { result.characters.last.map(\.isNewline) ?? true }

        mutating func breakLine() { if !atLineStart { result.append(AttributedString("\n")) } }

        mutating func append(_ text: String) {
            var piece = AttributedString(text)
            var intent: InlinePresentationIntent = []
            if bold > 0 { intent.insert(.stronglyEmphasized) }
            if italic > 0 { intent.insert(.emphasized) }
            if !intent.isEmpty { piece.inlinePresentationIntent = intent }
            if let link = links.last, let link { piece.link = link }
            piece.font = RichTextStyle.font(for: intent)
            result.append(piece)
        }
    }

    /// The editor text for a draft's HTML (without the signature block). Tags other than the ones the editor writes are dropped
    /// and their text kept.
    static func attributed(fromHTML html: String) -> AttributedString {
        var builder = Builder()
        let whole = NSRange(html.startIndex..., in: html)
        for match in tokenPattern.matches(in: html, range: whole) {
            guard let range = Range(match.range, in: html) else { continue }
            let token = String(html[range])
            if token.hasPrefix("<") { apply(tag: token, to: &builder) } else if !builder.skipping { appendText(token, to: &builder) }
        }
        while builder.result.characters.last?.isNewline == true { builder.result.characters.removeLast() }
        return builder.result
    }

    private static func appendText(_ raw: String, to builder: inout Builder) {
        var text = decodeEntities(raw).replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        if builder.atLineStart { text = String(text.drop(while: { $0 == " " })) }
        if !text.isEmpty { builder.append(text) }
    }

    private static func apply(tag token: String, to builder: inout Builder) {
        guard !token.hasPrefix("<!") else { return }
        let closing = token.hasPrefix("</")
        let name = token.dropFirst(closing ? 2 : 1).prefix { $0.isLetter || $0.isNumber }.lowercased()
        switch name {
        case "style", "script": builder.skipping = !closing
        case "b", "strong": builder.bold = max(0, builder.bold + (closing ? -1 : 1))
        case "i", "em": builder.italic = max(0, builder.italic + (closing ? -1 : 1))
        case "a":
            if closing { if !builder.links.isEmpty { builder.links.removeLast() } } else { builder.links.append(href(in: token)) }
        case "br": builder.result.append(AttributedString("\n"))
        case "li":
            builder.breakLine()
            if !closing { builder.append(bullet) }
        default: if blockTags.contains(name) { builder.breakLine() }
        }
    }

    private static func href(in tag: String) -> URL? {
        guard let match = hrefPattern.firstMatch(in: tag, range: NSRange(tag.startIndex..., in: tag)) else { return nil }
        for group in 1...2 {
            if let range = Range(match.range(at: group), in: tag) { return URL(string: decodeEntities(String(tag[range]))) }
        }
        return nil
    }

    static func decodeEntities(_ text: String) -> String {
        guard text.contains("&") else { return text }
        var out = text
        for (entity, value) in [("&nbsp;", " "), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", "\""), ("&#39;", "'"), ("&apos;", "'")] {
            out = out.replacingOccurrences(of: entity, with: value)
        }
        let numeric = try! NSRegularExpression(pattern: #"&#(x?[0-9a-fA-F]+);"#)
        for match in numeric.matches(in: out, range: NSRange(out.startIndex..., in: out)).reversed() {
            guard let whole = Range(match.range, in: out), let code = Range(match.range(at: 1), in: out) else { continue }
            let digits = out[code]
            let value = digits.hasPrefix("x") ? UInt32(digits.dropFirst(), radix: 16) : UInt32(digits)
            if let value, let scalar = Unicode.Scalar(value) { out.replaceSubrange(whole, with: String(Character(scalar))) }
        }
        return out.replacingOccurrences(of: "&amp;", with: "&")
    }
}
