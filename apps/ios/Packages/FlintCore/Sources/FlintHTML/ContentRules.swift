import Foundation

/// JSON builders for `WKContentRuleList` (compiled by the reader with `WKContentRuleListStore`).
///
/// The reader attaches up to three lists to every message web view:
/// 1. `remoteLoads(allowImages:)`: blocks every http(s) subresource. With `allowImages` (the per-message "Load images"
///    choice) image loads are left alone; styles, fonts, scripts, media and fetches stay blocked.
/// 2. `trackers()`: blocks known tracker URLs for every resource type, so a pixel hidden in CSS is stopped too.
/// 3. `receipts(host:)`: blocks the user's own receipts service, so reading a sent message never triggers its pixel.
///
/// WebKit applies a block from any attached list, so the tracker and receipts lists win over "Load images".
/// `data:`, `cid:` and the app's attachment scheme never match `^https?://`, so inline images keep working.
/// The url-filter dialect has no alternation, so tracker path patterns are expanded into one rule per literal path.
public enum ContentRuleLists {
    public static let remoteLoadsIdentifier = "co.xanom.flint.reader.remote"
    public static let remoteLoadsWithImagesIdentifier = "co.xanom.flint.reader.remote-images"
    public static let trackersIdentifier = "co.xanom.flint.reader.trackers"
    public static let receiptsIdentifier = "co.xanom.flint.reader.receipts"

    private static let blockedWithImages = ["style-sheet", "font", "script", "raw", "svg-document", "media", "popup", "ping", "fetch"]
    private static let blockedAll = ["image"] + blockedWithImages

    public static func remoteLoads(allowImages: Bool) -> String {
        let types = allowImages ? blockedWithImages : blockedAll
        var rules: [[String: Any]] = [
            rule(filter: "^https?://", types: types),
            rule(filter: "^wss?://", types: nil),
            rule(filter: "^ftp://", types: nil),
        ]
        rules.append(["trigger": ["url-filter": "^https?://", "resource-type": ["document"], "load-context": ["child-frame"]], "action": ["type": "block"]])
        return encode(rules)
    }

    public static func trackers() -> String {
        encode(trackerFilters().map { rule(filter: $0, types: nil) })
    }

    /// nil when the host cannot be parsed.
    public static func receipts(host: String) -> String? {
        let cleaned = host.contains("://") ? host : "https://\(host)"
        guard let parsed = TrackerRules.hostOf(cleaned) else { return nil }
        return encode(hostFilters(parsed, pathLiteral: nil).map { rule(filter: $0, types: nil) })
    }

    // MARK: - Tracker expansion

    /// Every url-filter the tracker table needs. Rules whose path pattern cannot be expanded are skipped (the
    /// sanitizer still removes those images; this list is the second layer).
    public static func trackerFilters() -> [String] {
        var filters: [String] = []
        for rule in TrackerRules.all {
            guard let pattern = rule.pathPattern else {
                filters += hostFilters(rule.host, pathLiteral: nil)
                continue
            }
            guard let literals = expandPathPattern(pattern) else { continue }
            for literal in literals { filters += hostFilters(rule.host, pathLiteral: literal) }
        }
        return filters
    }

    private static func hostFilters(_ host: String, pathLiteral: String?) -> [String] {
        let h = escape(host)
        guard let literal = pathLiteral else {
            return ["^https?://\(h)[:/?#]", "^https?://[a-z0-9.-]*\\.\(h)[:/?#]"]
        }
        return ["^https?://\(h).*\(literal)", "^https?://[a-z0-9.-]*\\.\(h).*\(literal)"]
    }

    private static let boundaryMarker: Character = "\u{1}"
    /// What can follow a word character run (the JS `\b` at the end of a path pattern): a separator or the end.
    private static let boundaryFollowers = ["/", "?", "\\.", "-", "#", "&", "=", ":", "$"]

    /// Expands the JavaScript path regex subset used by the tracker table (literals, `\x` escapes, groups with `|`
    /// and `?`, top-level `|`, `\b`) into url-filter literals. nil when the pattern uses anything else.
    static func expandPathPattern(_ pattern: String) -> [String]? {
        var chars = Array(pattern)[...]
        guard let alternatives = parseAlternatives(&chars, nested: false), chars.isEmpty else { return nil }
        var out: [String] = []
        for alt in alternatives {
            let pieces = alt.split(separator: boundaryMarker, omittingEmptySubsequences: false)
            if pieces.count == 1 { out.append(escapeLiteral(alt)); continue }
            // Only a trailing boundary is supported.
            guard pieces.count == 2, pieces[1].isEmpty else { return nil }
            let head = escapeLiteral(String(pieces[0]))
            out += boundaryFollowers.map { head + $0 }
        }
        return out
    }

    private static func parseAlternatives(_ chars: inout ArraySlice<Character>, nested: Bool) -> [String]? {
        var results: [String] = []
        var sequences = [""]
        while let c = chars.first {
            switch c {
            case "|":
                results += sequences
                sequences = [""]
                chars.removeFirst()
            case ")":
                if !nested { return nil }
                results += sequences
                return results
            case "(":
                chars.removeFirst()
                guard var inner = parseAlternatives(&chars, nested: true), chars.first == ")" else { return nil }
                chars.removeFirst()
                if chars.first == "?" {
                    chars.removeFirst()
                    inner.append("")
                }
                sequences = sequences.flatMap { prefix in inner.map { prefix + $0 } }
            case "\\":
                chars.removeFirst()
                guard let escaped = chars.first else { return nil }
                chars.removeFirst()
                let literal = escaped == "b" ? String(boundaryMarker) : String(escaped)
                sequences = sequences.map { $0 + literal }
            case "[", "]", "*", "+", "?", ".", "^", "$", "{", "}":
                return nil
            default:
                chars.removeFirst()
                sequences = sequences.map { $0 + String(c) }
            }
        }
        if nested { return nil }
        results += sequences
        return results
    }

    /// Escapes regex metacharacters for the url-filter dialect. A trailing "$" boundary stays an anchor.
    private static func escapeLiteral(_ s: String) -> String { escape(s) }

    private static func escape(_ s: String) -> String {
        var out = ""
        for ch in s {
            if ".+*?()[]{}^$|\\".contains(ch) { out += "\\" }
            out.append(ch)
        }
        return out
    }

    // MARK: - JSON

    private static func rule(filter: String, types: [String]?) -> [String: Any] {
        var trigger: [String: Any] = ["url-filter": filter]
        if let types { trigger["resource-type"] = types }
        return ["trigger": trigger, "action": ["type": "block"]]
    }

    private static func encode(_ rules: [[String: Any]]) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: rules, options: [.sortedKeys])) ?? Data("[]".utf8)
        return String(decoding: data, as: UTF8.self)
    }
}
