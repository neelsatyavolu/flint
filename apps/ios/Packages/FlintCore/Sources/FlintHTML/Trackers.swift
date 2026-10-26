import Foundation

/// Known email tracking pixels (port of packages/core/src/sanitize/trackers.ts).
/// A rule with no `pathPattern` means the whole host only serves tracking. A rule with a path pattern is for hosts that
/// also serve real content, so only URLs whose path and query match are treated as pixels.
public struct TrackerRule: Sendable, Hashable {
    public let host: String
    /// JavaScript regex source, matched case-insensitively against `pathname + search`.
    public let pathPattern: String?

    public init(host: String, pathPattern: String? = nil) {
        self.host = host
        self.pathPattern = pathPattern
    }
}

public enum TrackerRules {
    /// Compiled path patterns, parallel to `all`.
    private static let compiled: [NSRegularExpression?] = all.map { rule in
        rule.pathPattern.flatMap { try? NSRegularExpression(pattern: $0, options: [.caseInsensitive]) }
    }

    /// Image URL paths that look like an open pixel on any host. Used only for tiny or hidden images.
    private static let genericPixelPath = try! NSRegularExpression(
        pattern: #"(?:^|[/._-])(?:open(?:ed)?|track(?:ing)?|pixel|beacon|trk|wf/open|e/o|o\.gif)(?:[/._?-]|$)"#,
        options: [.caseInsensitive]
    )

    /// Lowercase host of a URL (protocol-relative allowed), or nil when it has no usable host.
    public static func hostOf(_ url: String) -> String? {
        parts(of: url)?.host
    }

    public static func hostMatches(_ host: String, _ rule: String) -> Bool {
        host == rule || host.hasSuffix(".\(rule)")
    }

    /// True when the URL points at the user's own receipts service (their pixel on mail they sent).
    public static func isReceiptsURL(_ url: String, receiptsHost: String?) -> Bool {
        guard let receiptsHost, !receiptsHost.isEmpty else { return false }
        guard let host = hostOf(url) else { return false }
        let wanted = hostOf(receiptsHost.contains("://") ? receiptsHost : "https://\(receiptsHost)")
        guard let wanted else { return false }
        return hostMatches(host, wanted)
    }

    /// Known tracker host and path rules only (no size heuristics).
    public static func matches(_ url: String) -> Bool {
        guard let parts = parts(of: url) else { return false }
        for (index, rule) in all.enumerated() where hostMatches(parts.host, rule.host) {
            guard let regex = compiled[index] else {
                if rule.pathPattern == nil { return true }
                continue
            }
            if regex.firstMatch(in: parts.path, range: NSRange(parts.path.startIndex..., in: parts.path)) != nil { return true }
        }
        return false
    }

    /// Generic open-pixel heuristic for a tiny or hidden image.
    public static func looksLikePixel(_ url: String) -> Bool {
        guard let parts = parts(of: url) else { return false }
        let path = parts.pathname
        return genericPixelPath.firstMatch(in: path, range: NSRange(path.startIndex..., in: path)) != nil
    }

    struct URLParts {
        var host: String
        /// `pathname + search`, as the WHATWG URL class would report it.
        var path: String
        var pathname: String
    }

    /// A small http(s)-style URL splitter. Foundation's URL is too lenient for security decisions: it accepts
    /// hostless forms and treats some malformed input as valid.
    static func parts(of raw: String) -> URLParts? {
        var text = Substring(raw.trimmingCharacters(in: .whitespacesAndNewlines))
        if text.hasPrefix("//") { text = "https:" + text }
        guard let schemeEnd = text.range(of: "://") else { return nil }
        let scheme = text[text.startIndex..<schemeEnd.lowerBound]
        guard let first = scheme.unicodeScalars.first, first.properties.isAlphabetic, scheme.unicodeScalars.allSatisfy({ $0.isASCII && ($0.properties.isAlphabetic || ("0"..."9").contains(Character($0)) || "+-.".unicodeScalars.contains($0)) }) else { return nil }
        let rest = text[schemeEnd.upperBound...]
        let authorityEnd = rest.firstIndex(where: { $0 == "/" || $0 == "?" || $0 == "#" }) ?? rest.endIndex
        var authority = rest[rest.startIndex..<authorityEnd]
        if let at = authority.lastIndex(of: "@") { authority = authority[authority.index(after: at)...] }
        var host = String(authority)
        if host.hasPrefix("[") {
            guard let close = host.firstIndex(of: "]") else { return nil }
            host = String(host[host.startIndex...close])
        } else if let colon = host.firstIndex(of: ":") {
            host = String(host[host.startIndex..<colon])
        }
        host = host.lowercased()
        guard !host.isEmpty, host.unicodeScalars.allSatisfy({ !$0.properties.isWhitespace && $0.value > 0x20 && $0 != "<" && $0 != ">" && $0 != "\\" && $0 != "^" && $0 != "|" && $0 != "%" }) else { return nil }
        var tail = rest[authorityEnd...]
        if let hash = tail.firstIndex(of: "#") { tail = tail[tail.startIndex..<hash] }
        var pathname = tail
        var search = Substring("")
        if let q = tail.firstIndex(of: "?") {
            pathname = tail[tail.startIndex..<q]
            search = tail[q...]
        }
        let pathString = pathname.isEmpty ? "/" : String(pathname)
        return URLParts(host: host, path: pathString + String(search), pathname: pathString)
    }
}
