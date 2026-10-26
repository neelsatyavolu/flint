import FlintModel
import Foundation

/// What stops a send, ported from the desktop `validate.ts` and `receiptNote.ts`.
enum SoftStop: Hashable, Sendable { case noSubject, noAttachment }

enum SendCheck: Equatable, Sendable {
    case ok
    case noRecipients
    case confirm(SoftStop)
}

enum SendChecks {
    /// "attach"/"attaches" counts only with an object ("attach the deck"), so "attach no meaning" stays quiet.
    private static let mention = try! NSRegularExpression(
        pattern: #"\b(attach(ed|ments?|ing)|enclos(ed|ing)|attach(es)?\s+(it|them|this|these|that|those|the|a|an|my|our|your))\b"#,
        options: .caseInsensitive)

    static func mentionsAttachment(_ text: String) -> Bool {
        mention.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
    }

    /// Missing recipients block. A missing subject, or an attachment mentioned but not attached, can be confirmed past.
    /// `body` is the plain text the person wrote (no signature, no quoted mail). `skip` lists stops already confirmed.
    static func check(
        to: [Address], cc: [Address], bcc: [Address], subject: String, body: String, attachmentCount: Int, skip: Set<SoftStop> = []
    ) -> SendCheck {
        if to.count + cc.count + bcc.count == 0 { return .noRecipients }
        if !skip.contains(.noSubject), subject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return .confirm(.noSubject) }
        if !skip.contains(.noAttachment), attachmentCount == 0, mentionsAttachment(body) { return .confirm(.noAttachment) }
        return .ok
    }

    /// Why this message can't carry a read receipt, or nil when it can. Shown beside the toggle so it never promises tracking
    /// that will not happen.
    static func receiptBlocker(settings: Settings?, recipients: [Address], selfAddresses: [String]) -> String? {
        guard let settings else { return nil }
        if !settings.receipts.enabled { return String(localized: "Read receipts are off in Settings, so this message won't be tracked.", table: "Composer") }
        if settings.receipts.endpoint.trimmingCharacters(in: .whitespaces).isEmpty {
            return String(localized: "Read receipts need a receipts address in Settings. This message won't be tracked.", table: "Composer")
        }
        if settings.compose.plainTextOnly {
            return String(localized: "Plain text mode can't carry a read receipt, so this message won't be tracked.", table: "Composer")
        }
        let own = Set(selfAddresses.map { $0.lowercased() })
        if !recipients.isEmpty, recipients.allSatisfy({ own.contains($0.address.lowercased()) }) {
            return String(localized: "Every recipient is you, so there is nothing to track.", table: "Composer")
        }
        return nil
    }
}
