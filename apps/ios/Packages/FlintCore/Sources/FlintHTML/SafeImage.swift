import Foundation

/// Decides whether a remote image looks the same for every recipient, so loading it does not tell the sender which
/// person opened the mail. Port of packages/core/src/sanitize/safeImage.ts. A heuristic: a sender can still hide a
/// per-recipient id in an ordinary-looking file name.
public enum SafeImage {
    /// Query parameters that name the reader or the send. Any value under these makes the image personal.
    private static let identityParams: Set<String> = [
        "u", "uid", "user", "userid", "user_id", "rid", "recipient", "recipient_id", "sub", "subscriber", "subscriber_id", "sid",
        "e", "em", "email", "mail", "addr", "contact", "contact_id", "cid", "mid", "msgid", "message_id", "eid", "tid", "lid",
        "token", "t", "hash", "h", "key", "k", "jwt", "sig", "signature", "track", "tracking", "trk", "open", "upn", "p", "d", "c", "r",
    ]

    /// Query parameters image services use for size, format and cache busting. Their values are ignored.
    private static let layoutParams: Set<String> = [
        "w", "h", "width", "height", "fit", "crop", "auto", "fm", "format", "q", "quality", "dpr", "v", "ver", "version",
        "size", "s", "resize", "bg", "border", "rect", "fl", "f", "ar", "gravity", "scale", "mode", "rev", "ts", "cb", "cache",
    ]

    private static let imageFile = try! NSRegularExpression(pattern: #"\.(?:png|jpe?g|gif|webp|avif|svg|bmp|ico)$"#, options: .caseInsensitive)
    private static let anyAddress = try! NSRegularExpression(pattern: #"[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}"#, options: .caseInsensitive)
    private static let alnumRun = try! NSRegularExpression(pattern: "[a-z0-9]+", options: .caseInsensitive)
    /// Image CDNs file content under a hex hash (md5 to sha256), which is the same for every recipient.
    private static let contentHash = try! NSRegularExpression(pattern: "^[0-9a-f]{16,64}$", options: .caseInsensitive)

    private static func matches(_ re: NSRegularExpression, _ s: String) -> Bool {
        re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil
    }

    /// Unbroken runs of letters and digits long enough to be an id or encoded payload.
    private static func tokenRuns(_ text: String, minLength: Int) -> [String] {
        alnumRun.matches(in: text, range: NSRange(text.startIndex..., in: text)).compactMap { m in
            guard let r = Range(m.range, in: text) else { return nil }
            let run = String(text[r])
            guard run.count >= minLength, run.contains(where: \.isLetter), run.contains(where: \.isNumber) else { return nil }
            return run
        }
    }

    /// The forms a recipient address takes when a sender embeds it in a URL.
    private static func addressForms(_ address: String) -> [String] {
        let a = address.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard a.contains("@") else { return [] }
        var b64 = Data(a.utf8).base64EncodedString()
        while b64.hasSuffix("=") { b64.removeLast() }
        return [a, b64.lowercased(), b64.replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").lowercased()]
    }

    private static func decoded(_ text: String) -> String { text.removingPercentEncoding ?? text }

    /// True when the remote https image URL carries nothing that identifies the reader.
    public static func isSafe(_ url: String, recipients: [String]) -> Bool {
        guard let parts = URLComponents(string: url), parts.scheme?.lowercased() == "https", parts.host?.isEmpty == false,
              parts.user == nil, parts.password == nil else { return false }
        let whole = decoded(url).lowercased()
        if recipients.contains(where: { r in addressForms(r).contains(where: { whole.contains($0) }) }) { return false }
        // Any address at all in the URL (not only the reader's) is almost always a mailing list id.
        if matches(anyAddress, whole) { return false }

        let segments = parts.percentEncodedPath.split(separator: "/").map { decoded(String($0)) }
        let endsInImage = segments.last.map { matches(imageFile, $0) } ?? false
        for (i, segment) in segments.enumerated() {
            let isFile = endsInImage && i == segments.count - 1
            let stem = isFile ? imageFile.stringByReplacingMatches(in: segment, range: NSRange(segment.startIndex..., in: segment), withTemplate: "") : segment
            // A file name may carry a content hash; a run longer than a sha1 is an encoded payload.
            if isFile {
                if !tokenRuns(stem, minLength: 41).isEmpty { return false }
            } else if tokenRuns(stem, minLength: 16).contains(where: { !endsInImage || !matches(contentHash, $0) }) {
                return false
            }
        }

        for item in parts.queryItems ?? [] {
            let key = item.name.lowercased()
            let value = item.value ?? ""
            if layoutParams.contains(key) { continue }
            if identityParams.contains(key) && !value.isEmpty { return false }
            if value.count >= 12 && value.contains(where: \.isNumber) { return false }
        }
        return true
    }
}
