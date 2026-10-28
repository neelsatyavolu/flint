// The signature block inside a draft's HTML, and which signature a new draft starts with.
// Port of packages/core/src/service/compose-signature.ts.

import FlintModel
import Foundation

enum Signatures {
    private static let openTag = try! NSRegularExpression(pattern: #"<div\b[^>]*\bclass="[^"]*\bflint_signature\b[^"]*"[^>]*>"#, options: .caseInsensitive)
    private static let divTag = try! NSRegularExpression(pattern: #"<(/?)div\b[^>]*>"#, options: .caseInsensitive)

    /// The marked block a signature lives in, so it can be found, swapped and removed later.
    static func block(_ signature: Signature) -> String {
        "<div class=\"flint_signature\" data-signature-id=\"\(signature.id)\">\(signature.html)</div>"
    }

    /// Range of the signature block, counting nested divs. Nil when the draft has none.
    private static func findBlock(_ html: String) -> Range<String.Index>? {
        let whole = NSRange(html.startIndex..., in: html)
        guard let open = openTag.firstMatch(in: html, range: whole), let start = Range(open.range, in: html)?.lowerBound else { return nil }
        var depth = 1
        let after = NSRange(location: open.range.upperBound, length: whole.length - open.range.upperBound)
        for match in divTag.matches(in: html, range: after) {
            let closing = match.range(at: 1).length > 0
            depth += closing ? -1 : 1
            if depth == 0, let end = Range(match.range, in: html)?.upperBound { return start..<end }
        }
        return start..<html.endIndex
    }

    static func has(_ html: String) -> Bool { findBlock(html) != nil }

    /// Puts `signature` in the draft: in place of the existing block, else after the body. Nil removes the block.
    static func replace(_ html: String, with signature: Signature?) -> String {
        guard let range = findBlock(html) else { return signature.map { "\(html)<br>\(block($0))" } ?? html }
        let before = String(html[..<range.lowerBound])
        let after = String(html[range.upperBound...])
        guard let signature else {
            return before.replacingOccurrences(of: #"(<br\s*/?>\s*)+$"#, with: "", options: [.regularExpression, .caseInsensitive]) + after
        }
        return before + block(signature) + after
    }

    private static func isReply(_ mode: ComposeMode) -> Bool { mode == .reply || mode == .replyAll }

    /// What settings say about an account: a signature id, `.some(nil)` for "none", nil for "no choice yet".
    static func chosenId(_ settings: Settings, accountId: AccountID, mode: ComposeMode) -> Int?? {
        if isReply(mode), let choice = settings.compose.defaultReplySignatureByAccount[accountId] { return .some(choice) }
        if let choice = settings.compose.defaultSignatureByAccount[accountId] { return .some(choice) }
        return nil
    }

    /// The signature a new draft starts with. Settings win when they name one for the account (null = none), otherwise the
    /// signature flagged as default for new mail or replies, account-specific before shared. A deleted choice counts as none made.
    static func defaultSignature(all: [Signature], settings: Settings, accountId: AccountID, mode: ComposeMode) -> Signature? {
        switch chosenId(settings, accountId: accountId, mode: mode) {
        case .some(.none): return nil
        case .some(.some(let id)): if let found = all.first(where: { $0.id == id }) { return found }
        case .none: break
        }
        let flagged = all.filter { isReply(mode) ? $0.defaultReply : $0.defaultNew }
        return flagged.first { $0.accountIds.contains(accountId) } ?? flagged.first { $0.accountIds.isEmpty }
    }
}
