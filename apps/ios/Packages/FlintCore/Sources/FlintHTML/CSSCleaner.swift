import Foundation

public struct CSSResult: Sendable, Equatable {
    public var css: String
    public var remoteUrls: [String]

    public init(css: String, remoteUrls: [String]) {
        self.css = css
        self.remoteUrls = remoteUrls
    }
}

/// CSS cleaning for inline styles and <style> blocks (port of packages/core/src/sanitize/css.ts).
/// Newsletters need CSS, so we keep it and drop only what can execute or escape. Every scan is a single linear pass
/// so hostile input (thousands of unclosed "url(") stays fast.
public enum CSSCleaner {
    /// A single style attribute or block larger than this is dropped; real mail CSS is far smaller.
    public static let maxLength = 512 * 1024

    private static let dangerous: [NSRegularExpression] = [
        #"expression\s*\("#, #"-moz-binding"#, #"(?<![A-Za-z0-9_])behavior\s*:"#, #"javascript\s*:"#, #"vbscript\s*:"#,
        #"position\s*:\s*(?:fixed|sticky)"#, #"@import"#, #"@charset"#,
    ].map { try! NSRegularExpression(pattern: $0, options: [.caseInsensitive]) }

    // MARK: - Escapes

    /// Decodes CSS escapes so `p\6fsition:fixed` is checked as `position:fixed`. Two passes, like the TypeScript.
    public static func decodeEscapes(_ css: String) -> String {
        decodeSimpleEscapes(decodeHexEscapes(css))
    }

    private static func hexValue(_ s: Unicode.Scalar) -> UInt32? {
        switch s.value {
        case 0x30...0x39: s.value - 0x30
        case 0x41...0x46: s.value - 0x41 + 10
        case 0x61...0x66: s.value - 0x61 + 10
        default: nil
        }
    }

    private static func decodeHexEscapes(_ css: String) -> String {
        let scalars = Array(css.unicodeScalars)
        var out = String.UnicodeScalarView()
        var i = 0
        while i < scalars.count {
            guard scalars[i] == "\\", i + 1 < scalars.count, hexValue(scalars[i + 1]) != nil else {
                out.append(scalars[i])
                i += 1
                continue
            }
            var j = i + 1
            var code: UInt32 = 0
            var digits = 0
            while j < scalars.count, digits < 6, let v = hexValue(scalars[j]) {
                code = code * 16 + v
                j += 1
                digits += 1
            }
            if j < scalars.count, scalars[j].properties.isWhitespace { j += 1 }
            if code > 0 && code <= 0x10FFFF {
                out.append(Unicode.Scalar(code) ?? "\u{FFFD}")
            }
            i = j
        }
        return String(out)
    }

    private static func decodeSimpleEscapes(_ css: String) -> String {
        let scalars = Array(css.unicodeScalars)
        var out = String.UnicodeScalarView()
        var i = 0
        while i < scalars.count {
            if scalars[i] == "\\", i + 1 < scalars.count {
                out.append(scalars[i + 1])
                i += 2
            } else {
                out.append(scalars[i])
                i += 1
            }
        }
        return String(out)
    }

    private static func isDangerous(_ piece: String) -> Bool {
        let decoded = decodeEscapes(piece).split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        let range = NSRange(decoded.startIndex..., in: decoded)
        return dangerous.contains { $0.firstMatch(in: decoded, range: range) != nil }
    }

    // MARK: - Scanning

    private static func stripComments(_ css: [UInt16]) -> [UInt16] {
        var out: [UInt16] = []
        out.reserveCapacity(css.count)
        var pos = 0
        while true {
            guard let open = find([0x2F, 0x2A], in: css, from: pos) else {
                out.append(contentsOf: css[pos...])
                break
            }
            out.append(contentsOf: css[pos..<open])
            guard let close = find([0x2A, 0x2F], in: css, from: open + 2) else { break }
            pos = close + 2
        }
        return out
    }

    private static func find(_ needle: [UInt16], in hay: [UInt16], from: Int) -> Int? {
        guard !needle.isEmpty, hay.count >= needle.count, from <= hay.count - needle.count else { return nil }
        var i = from
        let last = hay.count - needle.count
        while i <= last {
            if hay[i] == needle[0] {
                var k = 1
                while k < needle.count && hay[i + k] == needle[k] { k += 1 }
                if k == needle.count { return i }
            }
            i += 1
        }
        return nil
    }

    private static func lower(_ u: UInt16) -> UInt16 { (u >= 0x41 && u <= 0x5A) ? u + 32 : u }
    private static func isSpace(_ u: UInt16) -> Bool { u == 0x20 || (u >= 0x09 && u <= 0x0D) || u == 0xA0 || u == 0xFEFF || u == 0x2028 || u == 0x2029 }

    /// Index just past the ")" closing a group whose contents start at `from`, or nil. Honors nesting and quotes.
    private static func groupEnd(_ css: [UInt16], from: Int) -> Int? {
        var depth = 1
        var quote: UInt16 = 0
        var i = from
        while i < css.count {
            let ch = css[i]
            if quote != 0 {
                if ch == 0x5C { i += 1 } else if ch == quote { quote = 0 }
            } else if ch == 0x22 || ch == 0x27 {
                quote = ch
            } else if ch == 0x28 {
                depth += 1
            } else if ch == 0x29 {
                depth -= 1
                if depth == 0 { return i + 1 }
            }
            i += 1
        }
        return nil
    }

    /// After `from`: optional whitespace, optional quote, optional whitespace, optional `http:`/`https:`, then `//`.
    private static func startsRemote(_ css: [UInt16], from: Int) -> Bool {
        var i = from
        while i < css.count, isSpace(css[i]) { i += 1 }
        if i < css.count, css[i] == 0x22 || css[i] == 0x27 {
            i += 1
            while i < css.count, isSpace(css[i]) { i += 1 }
        }
        return hasRemoteScheme(css, at: i)
    }

    private static func hasRemoteScheme(_ css: [UInt16], at start: Int) -> Bool {
        var i = start
        if matches(Array("https:".utf16), css, i) { i += 6 } else if matches(Array("http:".utf16), css, i) { i += 5 }
        return i + 1 < css.count && css[i] == 0x2F && css[i + 1] == 0x2F
    }

    private static func matches(_ word: [UInt16], _ css: [UInt16], _ idx: Int) -> Bool {
        guard idx + word.count <= css.count else { return false }
        for k in 0..<word.count where lower(css[idx + k]) != word[k] { return false }
        return true
    }

    private static let urlOpen = Array("url(".utf16)
    private static let setOpen = Array("image-set(".utf16)
    private static let webkitPrefix = Array("-webkit-".utf16)

    private static func nextOpener(_ css: [UInt16], from: Int) -> (index: Int, isSet: Bool)? {
        var i = from
        while i < css.count {
            let c = lower(css[i])
            if c == 0x75, matches(urlOpen, css, i) { return (i, false) }
            if c == 0x69, matches(setOpen, css, i) { return (i, true) }
            i += 1
        }
        return nil
    }

    /// Replaces remote url(...) and image-set(...) references in one pass that never rescans text.
    /// An unclosed reference runs to the end, like in a browser.
    private static func replaceRemoteRefs(_ css: [UInt16], _ replace: (String) -> String) -> [UInt16] {
        var out: [UInt16] = []
        out.reserveCapacity(css.count)
        var pos = 0
        var scan = 0
        while let hit = nextOpener(css, from: scan) {
            var start = hit.index
            if hit.isSet, start - webkitPrefix.count >= scan, matches(webkitPrefix, css, start - webkitPrefix.count) {
                start -= webkitPrefix.count
            }
            let argStart = hit.index + (hit.isSet ? setOpen.count : urlOpen.count)
            scan = argStart
            if !hit.isSet && !startsRemote(css, from: argStart) { continue }
            let end: Int
            if hit.isSet {
                end = groupEnd(css, from: argStart) ?? css.count
            } else {
                end = css[argStart...].firstIndex(of: 0x29).map { $0 + 1 } ?? css.count
            }
            let whole = Array(css[start..<end])
            if hit.isSet && !containsQuotedRemote(whole) && !containsURLRemote(whole) { continue }
            out.append(contentsOf: css[pos..<start])
            out.append(contentsOf: Array(replace(String(decoding: whole, as: UTF16.self)).utf16))
            pos = end
            scan = end
        }
        out.append(contentsOf: css[pos...])
        return out
    }

    /// `['"]\s*(?:https?:)?//` anywhere.
    private static func containsQuotedRemote(_ text: [UInt16]) -> Bool {
        for i in text.indices where text[i] == 0x22 || text[i] == 0x27 {
            var j = i + 1
            while j < text.count, isSpace(text[j]) { j += 1 }
            if hasRemoteScheme(text, at: j) { return true }
        }
        return false
    }

    /// `url\(\s*['"]?\s*(?:https?:)?//` anywhere.
    private static func containsURLRemote(_ text: [UInt16]) -> Bool {
        var i = 0
        while i < text.count {
            if lower(text[i]) == 0x75, matches(urlOpen, text, i), startsRemote(text, from: i + urlOpen.count) { return true }
            i += 1
        }
        return false
    }

    // MARK: - Public entry

    /// Cleans a CSS string (a style block or an inline style attribute). Declarations and statements that can execute
    /// script, pin content over the app (position:fixed) or pull in external stylesheets are removed. Remote url()
    /// references are removed unless `allowRemote`.
    public static func clean(_ input: String, allowRemote: Bool) -> CSSResult {
        let units = Array(input.utf16)
        if units.count > maxLength { return CSSResult(css: "", remoteUrls: []) }
        var cleaned = stripComments(units).filter { $0 != 0x3C && $0 != 0 }

        func run(_ text: [UInt16]) -> (out: [UInt16], found: [String]) {
            var found: [String] = []
            let out = replaceRemoteRefs(text) { match in
                found.append(match)
                return allowRemote ? match : "none"
            }
            return (out, found)
        }

        var (out, found) = run(cleaned)
        if cleaned.contains(0x5C) {
            // Escapes like \75rl( or url(\68ttps://) hide a remote reference from the raw text.
            let decoded = Array(decodeEscapes(String(decoding: cleaned, as: UTF16.self)).utf16)
            let viaDecoded = run(decoded)
            if viaDecoded.found.count > found.count { (out, found) = viaDecoded }
        }
        cleaned = out

        var result = ""
        for (body, delim) in statements(String(decoding: cleaned, as: UTF16.self)) {
            if delim != "{" && !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && isDangerous(body) {
                if delim == "}" { result.append(delim) }
                continue
            }
            result.append(body)
            result.append(delim)
        }
        return CSSResult(css: result.trimmingCharacters(in: .whitespacesAndNewlines), remoteUrls: found)
    }

    /// Splits at `{`, `}` and `;`, keeping each delimiter with the text before it.
    private static func statements(_ css: String) -> [(String, String)] {
        var out: [(String, String)] = []
        var current = String.UnicodeScalarView()
        for ch in css.unicodeScalars {
            if ch == "{" || ch == "}" || ch == ";" {
                out.append((String(current), String(ch)))
                current = String.UnicodeScalarView()
            } else {
                current.append(ch)
            }
        }
        out.append((String(current), ""))
        return out
    }
}
