import Foundation

/// Tells whether a draft's HTML survives a trip through the native editor, which writes only div, br, b, i, a, ul and li.
/// A draft written elsewhere (tables, inline images, colours, font sizes) does not, so the composer keeps its HTML as it is.
enum DraftHTMLFidelity {
    private static let tagPattern = try! NSRegularExpression(pattern: #"<\s*(/?)\s*([a-zA-Z][a-zA-Z0-9]*)([^>]*)>"#)
    private static let plainTags: Set<String> = ["div", "p", "br", "b", "strong", "i", "em", "a", "ul", "li", "span"]
    private static let attributePattern = try! NSRegularExpression(pattern: #"([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*="#)

    static func isLossless(_ html: String) -> Bool {
        let whole = NSRange(html.startIndex..., in: html)
        for match in tagPattern.matches(in: html, range: whole) {
            guard let nameRange = Range(match.range(at: 2), in: html), let restRange = Range(match.range(at: 3), in: html) else { continue }
            let name = html[nameRange].lowercased()
            guard plainTags.contains(name) else { return false }
            let rest = String(html[restRange])
            let isClosing = match.range(at: 1).length > 0
            let bare = rest.trimmingCharacters(in: CharacterSet(charactersIn: " /\n\t"))
            if bare.isEmpty || isClosing { continue }
            let attributes = attributePattern.matches(in: rest, range: NSRange(rest.startIndex..., in: rest))
                .compactMap { Range($0.range(at: 1), in: rest).map { rest[$0].lowercased() } }
            if !(name == "a" && attributes == ["href"]) { return false }
        }
        return true
    }
}
