import Foundation
import SwiftSoup

/// 1x1 transparent GIF that stands in for blocked remote images.
public let placeholderGIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"

public struct SanitizeOptions: Sendable {
    /// Load remote images. When false they become a transparent placeholder that keeps width and height.
    public var allowRemoteImages: Bool
    /// Host of the user's own receipts service. Anything pointing at it is removed.
    public var receiptsHost: String?
    /// Maps a Content-ID (without `cid:`) to a URL the reader can load, or nil when unknown.
    public var cidResolver: (@Sendable (String) -> String?)?
    /// Remove known tracking pixels. Default true.
    public var blockTrackers: Bool

    public init(
        allowRemoteImages: Bool, receiptsHost: String? = nil, cidResolver: (@Sendable (String) -> String?)? = nil, blockTrackers: Bool = true
    ) {
        self.allowRemoteImages = allowRemoteImages
        self.receiptsHost = receiptsHost
        self.cidResolver = cidResolver
        self.blockTrackers = blockTrackers
    }
}

public struct SanitizeResult: Sendable, Equatable {
    public var html: String
    /// Known third-party tracking pixels were removed.
    public var hasTrackers: Bool
    /// The message has remote images that are blocked (or were loaded) that are not trackers.
    public var hasRemoteImages: Bool
    /// Number of tracking pixels removed (for the "N trackers blocked" label).
    public var trackerCount: Int

    public init(html: String, hasTrackers: Bool, hasRemoteImages: Bool, trackerCount: Int) {
        self.html = html
        self.hasTrackers = hasTrackers
        self.hasRemoteImages = hasRemoteImages
        self.trackerCount = trackerCount
    }
}

/// Makes mail HTML safe for a WKWebView that has JavaScript off (port of sanitize/index.ts, rebuilt on SwiftSoup).
/// The output is a body fragment, not a document. Scripts, event handlers, forms, frames, objects, meta refresh, base
/// tags, javascript: and non-image data: URLs and external stylesheets are removed. Inline styles and style blocks stay.
/// This is a defense in depth layer: the reader also blocks every remote load with a content rule list.
public enum HTMLSanitizer {
    /// Bodies larger than this are rendered as plain text; it bounds parsing time.
    public static let maxHTMLLength = 3 * 1024 * 1024

    public static func sanitize(_ html: String, _ options: SanitizeOptions) -> SanitizeResult {
        if html.utf16.count > maxHTMLLength {
            let head = String(decoding: Array(html.utf16.prefix(maxHTMLLength)), as: UTF16.self)
            let text = HTMLText.htmlToText(head)
            return SanitizeResult(html: "<pre style=\"white-space:pre-wrap\">\(HTMLSerializer.escapeText(text))</pre>", hasTrackers: false, hasRemoteImages: false, trackerCount: 0)
        }
        let input = html.replacingOccurrences(of: "\u{0}", with: "")
        guard let doc = try? SwiftSoup.parse(input) else {
            return SanitizeResult(html: HTMLSerializer.escapeText(HTMLText.htmlToText(input)), hasTrackers: false, hasRemoteImages: false, trackerCount: 0)
        }
        var run = SanitizeRun(options: options, bodyInSource: hasBodyTag(input))
        run.walk(doc)
        return SanitizeResult(html: run.out, hasTrackers: run.trackerCount > 0, hasRemoteImages: run.hasRemoteImages, trackerCount: run.trackerCount)
    }

    private static func hasBodyTag(_ html: String) -> Bool {
        var search = html.startIndex..<html.endIndex
        while let r = html.range(of: "<body", options: .caseInsensitive, range: search) {
            let next = r.upperBound
            if next == html.endIndex { return true }
            let ch = html.unicodeScalars[next]
            if !(ch.properties.isAlphabetic || ("0"..."9").contains(Character(ch))) { return true }
            search = next..<html.endIndex
        }
        return false
    }
}

enum HTMLSerializer {
    static func escapeText(_ s: String) -> String {
        var out = ""
        out.reserveCapacity(s.utf8.count)
        for ch in s.unicodeScalars {
            switch ch {
            case "&": out += "&amp;"
            case "<": out += "&lt;"
            case ">": out += "&gt;"
            default: out.unicodeScalars.append(ch)
            }
        }
        return out
    }

    static func escapeAttribute(_ s: String) -> String {
        var out = ""
        out.reserveCapacity(s.utf8.count)
        for ch in s.unicodeScalars {
            switch ch {
            case "&": out += "&amp;"
            case "\"": out += "&quot;"
            case "<": out += "&lt;"
            case ">": out += "&gt;"
            default: out.unicodeScalars.append(ch)
            }
        }
        return out
    }
}

private enum Policy {
    static let allowedTags: Set<String> = [
        "a", "abbr", "address", "article", "aside", "b", "bdi", "bdo", "big", "blockquote", "br", "caption", "center", "cite",
        "code", "col", "colgroup", "dd", "del", "details", "dfn", "div", "dl", "dt", "em", "figcaption", "figure", "font",
        "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "i", "img", "ins", "kbd", "li", "main", "mark", "nav", "ol",
        "p", "pre", "q", "s", "samp", "section", "small", "span", "strike", "strong", "style", "sub", "summary", "sup",
        "table", "tbody", "td", "tfoot", "th", "thead", "time", "tr", "tt", "u", "ul", "var", "wbr",
    ]
    /// Elements dropped together with everything inside them.
    static let nonText: Set<String> = [
        "script", "textarea", "option", "noscript", "title", "template", "iframe", "noembed", "noframes", "xmp", "object", "embed",
    ]
    static let voidTags: Set<String> = ["br", "hr", "img", "col", "wbr"]
    static let globalAttrs: Set<String> = [
        "class", "id", "style", "dir", "lang", "title", "align", "valign", "width", "height", "bgcolor", "color", "border", "role",
    ]
    static let tableAttrs: Set<String> = ["cellpadding", "cellspacing", "colspan", "rowspan", "background", "nowrap", "scope", "span"]
    static let tableTags: Set<String> = ["table", "td", "th", "tr", "tbody", "thead", "tfoot", "col", "colgroup"]

    static func allowedAttrs(for tag: String) -> Set<String> {
        var set = globalAttrs
        switch tag {
        case "a": set.formUnion(["href", "name", "target", "rel"])
        case "img": set.formUnion(["src", "alt"])
        case "font": set.formUnion(["face", "size"])
        case "ol": set.formUnion(["start", "type"])
        case "li": set.insert("value")
        case "time": set.insert("datetime")
        case "q", "blockquote": set.insert("cite")
        default: if tableTags.contains(tag) { set.formUnion(tableAttrs) }
        }
        return set
    }

    static let dataImage = try! NSRegularExpression(
        pattern: #"^data:image/(?:png|jpe?g|gif|webp|bmp|avif|x-icon|vnd\.microsoft\.icon)[;,]"#, options: [.caseInsensitive]
    )
    static let safeHref = try! NSRegularExpression(pattern: #"^(?:https?:|mailto:|tel:|#)"#, options: [.caseInsensitive])
    static let remoteSrc = try! NSRegularExpression(pattern: #"^(?:https?:)?//"#, options: [.caseInsensitive])
    static let sizeValue = try! NSRegularExpression(pattern: #"^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$"#, options: [.caseInsensitive])
    static let styleWidth = styleSizeRegex("width")
    static let styleHeight = styleSizeRegex("height")
    static let hiddenStyle = try! NSRegularExpression(
        pattern: #"display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0+)?\s*(?:;|$)|max-height\s*:\s*0|font-size\s*:\s*0"#
    )

    private static func styleSizeRegex(_ prop: String) -> NSRegularExpression {
        try! NSRegularExpression(
            pattern: #"(?:^|[;\s])\#(prop)\s*:\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*(?:!important)?\s*(?:;|$)"#, options: [.caseInsensitive]
        )
    }
}

private func matches(_ regex: NSRegularExpression, _ s: String) -> Bool {
    regex.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil
}

/// The readers load remote images over https only (desktop CSP, iOS App Transport Security), so http:// and // are upgraded.
private func httpsURL(_ url: String) -> String {
    Policy.remoteSrc.stringByReplacingMatches(in: url, range: NSRange(url.startIndex..., in: url), withTemplate: "https://")
}

private func firstGroupNumber(_ regex: NSRegularExpression, _ s: String) -> Double? {
    guard let m = regex.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)), m.numberOfRanges > 1, let r = Range(m.range(at: 1), in: s) else { return nil }
    return Double(s[r])
}

private struct SanitizeRun {
    let options: SanitizeOptions
    let bodyInSource: Bool
    var out = ""
    var trackerCount = 0
    var hasRemoteImages = false

    init(options: SanitizeOptions, bodyInSource: Bool) {
        self.options = options
        self.bodyInSource = bodyInSource
    }

    private enum Work {
        case node(Node)
        case close(String)
    }

    mutating func walk(_ root: Node) {
        var stack: [Work] = root.getChildNodes().reversed().map { .node($0) }
        while let work = stack.popLast() {
            switch work {
            case .close(let tag):
                out += "</\(tag)>"
            case .node(let node):
                visit(node, &stack)
            }
        }
    }

    private mutating func visit(_ node: Node, _ stack: inout [Work]) {
        if let text = node as? TextNode {
            out += HTMLSerializer.escapeText(text.getWholeText())
            return
        }
        guard let element = node as? Element else { return } // comments, doctype, stray data
        let tag = element.tagNameNormal()
        if Policy.nonText.contains(tag) { return }
        let children = element.getChildNodes()
        if tag == "style" {
            emitStyle(element, children)
            return
        }
        let emitTag: String
        if tag == "body" {
            guard bodyInSource else { return pushChildren(children, &stack) }
            emitTag = "div"
        } else if Policy.allowedTags.contains(tag) {
            emitTag = tag
        } else {
            return pushChildren(children, &stack) // discard the tag, keep what is inside it
        }
        var attrs = readAttributes(element)
        attrs = transformAll(attrs)
        switch emitTag {
        case "img":
            guard let next = transformImg(attrs) else { return }
            attrs = next
        case "a":
            attrs = transformLink(attrs)
        default: break
        }
        let allowed = Policy.allowedAttrs(for: emitTag)
        out += "<\(emitTag)"
        for (key, value) in attrs where allowed.contains(key) {
            if key == "style" && value.isEmpty { continue }
            out += " \(key)=\"\(HTMLSerializer.escapeAttribute(value))\""
        }
        out += ">"
        if Policy.voidTags.contains(emitTag) { return }
        stack.append(.close(emitTag))
        pushChildren(children, &stack)
    }

    private func pushChildren(_ children: [Node], _ stack: inout [Work]) {
        for child in children.reversed() { stack.append(.node(child)) }
    }

    private func readAttributes(_ element: Element) -> [(key: String, value: String)] {
        var seen = Set<String>()
        var list: [(key: String, value: String)] = []
        for attribute in element.getAttributes()?.asList() ?? [] {
            let key = attribute.getKey().lowercased()
            if seen.insert(key).inserted { list.append((key, attribute.getValue())) }
        }
        return list
    }

    private mutating func emitStyle(_ element: Element, _ children: [Node]) {
        var css = ""
        for child in children {
            if let data = child as? DataNode { css += data.getWholeData() } else if let text = child as? TextNode { css += text.getWholeText() }
        }
        out += "<style>\(cssFor(css))</style>"
    }

    private mutating func cssFor(_ css: String) -> String {
        let result = CSSCleaner.clean(css, allowRemote: options.allowRemoteImages)
        if !result.remoteUrls.isEmpty { hasRemoteImages = true }
        return result.css
    }

    // MARK: - Attribute transforms

    private func value(_ attrs: [(key: String, value: String)], _ key: String) -> String? {
        attrs.first(where: { $0.key == key })?.value
    }

    private func setting(_ attrs: [(key: String, value: String)], _ key: String, _ newValue: String?) -> [(key: String, value: String)] {
        var next = attrs
        if let index = next.firstIndex(where: { $0.key == key }) {
            if let newValue { next[index].value = newValue } else { next.remove(at: index) }
        } else if let newValue {
            next.append((key, newValue))
        }
        return next
    }

    private mutating func transformAll(_ input: [(key: String, value: String)]) -> [(key: String, value: String)] {
        var attrs = input
        if let style = value(attrs, "style") { attrs = setting(attrs, "style", cssFor(style)) }
        if let background = value(attrs, "background") {
            let bg = background.trimmingCharacters(in: .whitespacesAndNewlines)
            if matches(Policy.remoteSrc, bg) {
                hasRemoteImages = true
                let blocked = !options.allowRemoteImages
                    || TrackerRules.isReceiptsURL(bg, receiptsHost: options.receiptsHost)
                    || (options.blockTrackers && TrackerRules.matches(bg))
                attrs = setting(attrs, "background", blocked ? nil : httpsURL(bg))
            } else {
                attrs = setting(attrs, "background", nil)
            }
        }
        return attrs
    }

    private func transformLink(_ input: [(key: String, value: String)]) -> [(key: String, value: String)] {
        var attrs = input
        if let href = value(attrs, "href") {
            let trimmed = href.trimmingCharacters(in: .whitespacesAndNewlines)
            let stripped = String(String.UnicodeScalarView(href.unicodeScalars.filter { $0.value > 0x20 }))
            if !trimmed.isEmpty && !matches(Policy.safeHref, stripped) { attrs = setting(attrs, "href", nil) }
        }
        attrs = setting(attrs, "target", nil)
        attrs = setting(attrs, "rel", nil)
        if let href = value(attrs, "href"), !href.isEmpty, !href.hasPrefix("#") {
            attrs.append(("target", "_blank"))
            attrs.append(("rel", "noopener noreferrer"))
        }
        return attrs
    }

    /// Returns the attributes to emit, or nil when the image must be removed entirely.
    private mutating func transformImg(_ input: [(key: String, value: String)]) -> [(key: String, value: String)]? {
        var attrs = setting(setting(input, "srcset", nil), "background", nil)
        let src = (value(attrs, "src") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if src.isEmpty { return nil }
        let lowered = src.lowercased()
        if lowered.hasPrefix("cid:") {
            var cid = String(src.dropFirst(4))
            if cid.hasPrefix("<") { cid.removeFirst() }
            if cid.hasSuffix(">") { cid.removeLast() }
            if let resolved = options.cidResolver?(cid) { return setting(attrs, "src", resolved) }
            return setting(attrs, "src", placeholderGIF)
        }
        if lowered.hasPrefix("data:") {
            return matches(Policy.dataImage, src) ? attrs : nil
        }
        guard matches(Policy.remoteSrc, src) else { return nil }
        let full = httpsURL(src)
        if TrackerRules.isReceiptsURL(full, receiptsHost: options.receiptsHost) { return nil }
        if options.blockTrackers && (TrackerRules.matches(full) || (isTinyOrHidden(attrs) && TrackerRules.looksLikePixel(full))) {
            trackerCount += 1
            return nil
        }
        if TrackerRules.hostOf(full) == nil { return nil }
        hasRemoteImages = true
        attrs = setting(attrs, "src", full)
        if !options.allowRemoteImages { return setting(attrs, "src", placeholderGIF) }
        return attrs
    }

    private func isTinyOrHidden(_ attrs: [(key: String, value: String)]) -> Bool {
        let style = (value(attrs, "style") ?? "").lowercased()
        let w = parseSize(value(attrs, "width")) ?? firstGroupNumber(Policy.styleWidth, style)
        let h = parseSize(value(attrs, "height")) ?? firstGroupNumber(Policy.styleHeight, style)
        if let w, w <= 1 { return true }
        if let h, h <= 1 { return true }
        return matches(Policy.hiddenStyle, style)
    }

    private func parseSize(_ raw: String?) -> Double? {
        guard let raw, !raw.isEmpty else { return nil }
        return firstGroupNumber(Policy.sizeValue, raw)
    }
}
