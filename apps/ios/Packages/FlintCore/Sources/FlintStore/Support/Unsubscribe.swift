// List-Unsubscribe (RFC 2369) and List-Unsubscribe-Post (RFC 8058). Ported from store/unsubscribe.ts.

import FlintModel
import Foundation

enum UnsubscribeParser {
    /// Nil when there is nothing usable.
    static func parse(_ headers: [String: String]) -> UnsubscribeInfo? {
        guard let raw = headers["list-unsubscribe"], !raw.isEmpty,
              let regex = try? NSRegularExpression(pattern: "<([^>]+)>")
        else { return nil }
        let ns = raw as NSString
        let targets = regex.matches(in: raw, range: NSRange(location: 0, length: ns.length)).map {
            ns.substring(with: $0.range(at: 1)).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        let url = targets.first { $0.range(of: "^https?://", options: [.regularExpression, .caseInsensitive]) != nil }
        let mailto = targets.first { $0.range(of: "^mailto:", options: [.regularExpression, .caseInsensitive]) != nil }
        if url == nil && mailto == nil { return nil }
        let oneClick = url != nil && (headers["list-unsubscribe-post"] ?? "").range(of: "one-click", options: .caseInsensitive) != nil
        return UnsubscribeInfo(url: url, mailto: mailto, oneClick: oneClick)
    }
}
