import FlintModel
import Foundation

/// The signature block inside a draft's HTML and which signature a draft starts with. Same rules as the service
/// (`Signatures` in FlintService, which is internal): a marked `flint_signature` div, one line above it.
enum SignatureRules {
    private static let openTag = try! NSRegularExpression(pattern: #"<div\b[^>]*\bclass="[^"]*\bflint_signature\b[^"]*"[^>]*>"#, options: .caseInsensitive)
    private static let divTag = try! NSRegularExpression(pattern: #"<(/?)div\b[^>]*>"#, options: .caseInsensitive)

    struct Split: Equatable {
        /// The HTML the person writes in, without the signature and the line above it.
        var body: String
        /// The inside of the signature block; nil when the draft has none.
        var signatureHTML: String?
        var signatureId: Int?
    }

    static func block(_ signature: Signature) -> String {
        "<div class=\"flint_signature\" data-signature-id=\"\(signature.id)\">\(signature.html)</div>"
    }

    /// Splits a draft's HTML into the body and the signature block.
    static func split(_ html: String) -> Split {
        let whole = NSRange(html.startIndex..., in: html)
        guard let open = openTag.firstMatch(in: html, range: whole), let openRange = Range(open.range, in: html) else {
            return Split(body: html, signatureHTML: nil, signatureId: nil)
        }
        var depth = 1
        var end = html.endIndex
        var innerEnd = html.endIndex
        let after = NSRange(location: open.range.upperBound, length: whole.length - open.range.upperBound)
        for match in divTag.matches(in: html, range: after) {
            depth += match.range(at: 1).length > 0 ? -1 : 1
            if depth == 0, let range = Range(match.range, in: html) {
                end = range.upperBound
                innerEnd = range.lowerBound
                break
            }
        }
        let tag = String(html[openRange])
        let id = tag.range(of: #"data-signature-id="(\d+)""#, options: .regularExpression).flatMap { Int(tag[$0].filter(\.isNumber)) }
        var before = String(html[..<openRange.lowerBound])
        before = before.replacingOccurrences(of: #"(<br\s*/?>\s*)+$"#, with: "", options: [.regularExpression, .caseInsensitive])
        return Split(body: before + String(html[end...]), signatureHTML: String(html[openRange.upperBound..<innerEnd]), signatureId: id)
    }

    /// Body, one empty line, then the signature block.
    static func compose(body: String, signature: Signature?) -> String {
        guard let signature else { return body }
        return "\(body)<br>\(block(signature))"
    }

    private static func isReply(_ mode: ComposeMode) -> Bool { mode == .reply || mode == .replyAll }

    /// The signature a draft starts with (or gets after a From change). Settings win when they name one for the account (null =
    /// none); otherwise the signature flagged as default for new mail or replies, account-specific before shared.
    static func defaultSignature(all: [Signature], settings: Settings?, accountId: AccountID, mode: ComposeMode) -> Signature? {
        if let compose = settings?.compose {
            let chosen: Int??
            if isReply(mode), let choice = compose.defaultReplySignatureByAccount[accountId] {
                chosen = .some(choice)
            } else if let choice = compose.defaultSignatureByAccount[accountId] {
                chosen = .some(choice)
            } else {
                chosen = nil
            }
            switch chosen {
            case .some(.none): return nil
            case .some(.some(let id)): if let found = all.first(where: { $0.id == id }) { return found }
            case .none: break
            }
        }
        let flagged = all.filter { isReply(mode) ? $0.defaultReply : $0.defaultNew }
        return flagged.first { $0.accountIds.contains(accountId) } ?? flagged.first { $0.accountIds.isEmpty }
    }

    /// Signatures the person can pick for this account.
    static func available(_ all: [Signature], for accountId: AccountID) -> [Signature] {
        all.filter { $0.accountIds.isEmpty || $0.accountIds.contains(accountId) }
    }
}
