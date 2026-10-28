import Foundation

/// JavaScript-flavoured regex on top of NSRegularExpression (ICU).
///
/// JS `\w`, `\d` and `\b` are ASCII-only, ICU's are Unicode-aware (full-width digits, accented letters). Every pattern
/// the ported heuristics use goes through `JSRegex.translate`, which rewrites those three escapes to explicit ASCII
/// forms. `$` is not rewritten: write `\z` where JS meant end of input (ICU `$` also matches before a final newline).
struct JSRegex: @unchecked Sendable {
    private let regex: NSRegularExpression

    /// Returns nil when the pattern does not compile.
    init?(_ pattern: String, ignoreCase: Bool = false) {
        let options: NSRegularExpression.Options = ignoreCase ? [.caseInsensitive] : []
        guard let r = try? NSRegularExpression(pattern: JSRegex.translate(pattern), options: options) else { return nil }
        regex = r
    }

    /// For patterns written in this package; a bad one is a programming error.
    init(literal pattern: String, ignoreCase: Bool = false) {
        guard let r = JSRegex(pattern, ignoreCase: ignoreCase) else { fatalError("Invalid regex: \(pattern)") }
        self = r
    }

    private static let word = "A-Za-z0-9_"
    private static let boundary = "(?:(?<![\(word)])(?=[\(word)])|(?<=[\(word)])(?![\(word)]))"

    static func translate(_ pattern: String) -> String {
        var out = ""
        var inClass = false
        var it = pattern.makeIterator()
        while let ch = it.next() {
            if ch == "\\" {
                guard let next = it.next() else { out.append(ch); break }
                switch (next, inClass) {
                case ("w", false): out += "[\(word)]"
                case ("w", true): out += word
                case ("W", false): out += "[^\(word)]"
                case ("d", false): out += "[0-9]"
                case ("d", true): out += "0-9"
                case ("D", false): out += "[^0-9]"
                case ("b", false): out += boundary
                default: out.append(ch); out.append(next)
                }
                continue
            }
            if inClass {
                if ch == "]" { inClass = false }
                else if ch == "[" { out.append("\\") } // JS allows a bare "[" in a class, ICU reads it as a nested set
            } else if ch == "[" { inClass = true }
            out.append(ch)
        }
        return out
    }

    private func full(_ s: String) -> NSRange { NSRange(location: 0, length: (s as NSString).length) }

    func test(_ s: String) -> Bool { regex.firstMatch(in: s, range: full(s)) != nil }

    func first(in s: String) -> Match? {
        regex.firstMatch(in: s, range: full(s)).map { Match(string: s, result: $0) }
    }

    func all(in s: String) -> [Match] {
        regex.matches(in: s, range: full(s)).map { Match(string: s, result: $0) }
    }

    func replacing(in s: String, with template: String) -> String {
        regex.stringByReplacingMatches(in: s, range: full(s), withTemplate: template)
    }

    struct Match {
        let string: String
        let result: NSTextCheckingResult

        /// Capture group text; nil when the group did not participate.
        subscript(_ i: Int) -> String? {
            let r = result.range(at: i)
            guard r.location != NSNotFound else { return nil }
            return (string as NSString).substring(with: r)
        }
    }
}
