import Foundation
import Security

/// Pixel and address helpers (port of packages/core/src/receipts/pixel.ts and `canonicalAddress` in client.ts).
public enum ReceiptPixel {
    /// 22 base64url characters: the wire shape of both pixel tokens and message refs.
    public static let tokenLength = 22

    private static let bodyTag = try! NSRegularExpression(pattern: #"<body(?![A-Za-z0-9_])[^>]*>"#, options: [.caseInsensitive])

    /// 128-bit random id as 22 base64url characters.
    public static func newToken() -> String {
        var bytes = [UInt8](repeating: 0, count: 16)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        if status != errSecSuccess {
            for i in bytes.indices { bytes[i] = UInt8.random(in: .min ... .max) }
        }
        return Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    /// `^[A-Za-z0-9_-]{22}$` with ASCII-only semantics.
    public static func isTokenShape(_ token: String) -> Bool {
        let scalars = Array(token.unicodeScalars)
        return scalars.count == tokenLength && scalars.allSatisfy { s in
            s.isASCII && (s.properties.isAlphabetic || ("0"..."9").contains(Character(s)) || s == "_" || s == "-")
        }
    }

    /// Mailbox identity: lowercase, and for Gmail strip +tag and dots and unify googlemail.com.
    public static func canonicalAddress(_ raw: String) -> String {
        let addr = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard let at = addr.lastIndex(of: "@"), at != addr.startIndex else { return addr }
        var local = String(addr[addr.startIndex..<at])
        var domain = String(addr[addr.index(after: at)...])
        if domain == "gmail.com" || domain == "googlemail.com" {
            domain = "gmail.com"
            local = String(local.split(separator: "+", maxSplits: 1, omittingEmptySubsequences: false).first ?? "").replacingOccurrences(of: ".", with: "")
        }
        return "\(local)@\(domain)"
    }

    /// Normalizes the configured endpoint to an origin-style base URL, or nil when it is not a usable https URL
    /// (http only for loopback, so the bearer secret never travels in cleartext). Credentials in the URL are rejected.
    public static func normalizeEndpoint(_ raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let parts = URLComponents(string: trimmed), let scheme = parts.scheme?.lowercased(),
              let rawHost = parts.host, !rawHost.isEmpty, parts.user == nil, parts.password == nil else { return nil }
        let host = rawHost.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        let loopback = host == "localhost" || host == "127.0.0.1" || host == "::1"
        guard scheme == "https" || (scheme == "http" && loopback) else { return nil }
        var out = "\(scheme)://"
        out += host.contains(":") ? "[\(host)]" : host
        if let port = parts.port, !(scheme == "https" && port == 443), !(scheme == "http" && port == 80) { out += ":\(port)" }
        out += parts.percentEncodedPath
        if let query = parts.percentEncodedQuery { out += "?\(query)" }
        if let fragment = parts.percentEncodedFragment { out += "#\(fragment)" }
        while out.hasSuffix("/") { out.removeLast() }
        return out
    }

    public static func pixelURL(endpoint: String, token: String) -> String {
        "\(endpoint)/i/\(token).gif"
    }

    private static func escapeAttribute(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "\"", with: "&quot;").replacingOccurrences(of: "<", with: "&lt;")
    }

    public static func pixelTag(_ pixelURL: String) -> String {
        "<img src=\"\(escapeAttribute(pixelURL))\" width=\"1\" height=\"1\" alt=\"\" style=\"display:block;width:1px;height:1px;border:0;opacity:0\" />"
    }

    /// Puts the pixel as the first element inside <body>, or in front of the markup when there is no body tag.
    public static func injectPixel(into html: String, pixelURL: String) -> String {
        let tag = pixelTag(pixelURL)
        let range = NSRange(html.startIndex..., in: html)
        guard let match = bodyTag.firstMatch(in: html, range: range), let r = Range(match.range, in: html) else { return tag + html }
        return String(html[html.startIndex..<r.upperBound]) + tag + String(html[r.upperBound...])
    }
}
