// Recipients, subject, quoted block and threading headers for a reply, reply all or forward.
// Port of buildReplyDraft / prefixedSubject in packages/core/src/mail/compose.ts.
//
// The quoted original is not sanitized here: the caller passes it as `quotedBodyHTML`, already cleaned by the HTML module
// (remote images allowed, receipts pixels removed, cid images inlined) or produced by `plainTextBody`.

import FlintModel
import Foundation

public struct ReplySource: Sendable {
    public var from: [Address]
    public var to: [Address]
    public var cc: [Address]
    public var replyTo: [Address]
    public var subject: String
    public var date: EpochMs
    public var messageId: String?
    public var references: [String]

    public init(from: [Address], to: [Address], cc: [Address] = [], replyTo: [Address] = [], subject: String, date: EpochMs, messageId: String? = nil, references: [String] = []) {
        self.from = from
        self.to = to
        self.cc = cc
        self.replyTo = replyTo
        self.subject = subject
        self.date = date
        self.messageId = messageId
        self.references = references
    }
}

public struct ReplyDraft: Hashable, Sendable {
    public var to: [Address]
    public var cc: [Address]
    public var subject: String
    public var quotedHtml: String
    public var inReplyTo: String?
    public var references: [String]
    public var attachments: [DraftAttachment]
}

public enum ReplyDraftBuilder {
    private static let replyPrefix = try! NSRegularExpression(pattern: #"^(?:(?:re|aw|sv|antw)\s*:\s*)+"#, options: [.caseInsensitive])
    private static let forwardPrefix = try! NSRegularExpression(pattern: #"^(?:(?:fwd?|wg|vs)\s*:\s*)+"#, options: [.caseInsensitive])

    public static func prefixedSubject(_ subject: String, mode: ComposeMode) -> String {
        let s = subject.trimmingCharacters(in: .whitespacesAndNewlines)
        let range = NSRange(s.startIndex..., in: s)
        if mode == .forward {
            if forwardPrefix.firstMatch(in: s, range: range) != nil { return forwardPrefix.stringByReplacingMatches(in: s, range: range, withTemplate: "Fwd: ") }
            return "Fwd: \(s)"
        }
        if replyPrefix.firstMatch(in: s, range: range) != nil { return replyPrefix.stringByReplacingMatches(in: s, range: range, withTemplate: "Re: ") }
        return "Re: \(s)"
    }

    public static func escapeHTML(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
    }

    /// The quoted body of a message that has no html part.
    public static func plainTextBody(_ text: String?) -> String { "<div style=\"white-space:pre-wrap\">\(escapeHTML(text ?? ""))</div>" }

    private static func format(_ address: Address) -> String { address.name.isEmpty ? address.address : "\(address.name) <\(address.address)>" }

    private static func dedupe(_ list: [Address], excluding: Set<String>) -> [Address] {
        var seen = excluding
        var out: [Address] = []
        for address in list {
            let key = address.address.trimmingCharacters(in: .whitespaces).lowercased()
            if key.isEmpty || !seen.insert(key).inserted { continue }
            out.append(Address(name: address.name, address: address.address.trimmingCharacters(in: .whitespaces)))
        }
        return out
    }

    /// "Mon, Oct 5, 2026 at 10:04 PM" in the given time zone (the device's by default).
    public static func formatWhen(_ ms: EpochMs, timeZone: TimeZone = .current) -> String {
        let date = Date(timeIntervalSince1970: Double(ms) / 1000)
        let day = DateFormatter()
        day.locale = Locale(identifier: "en_US_POSIX")
        day.timeZone = timeZone
        day.dateFormat = "EEE, MMM d, yyyy"
        let time = DateFormatter()
        time.locale = Locale(identifier: "en_US_POSIX")
        time.timeZone = timeZone
        time.dateFormat = "h:mm a"
        return "\(day.string(from: date)) at \(time.string(from: date))"
    }

    /// Reply all drops the user's own addresses and aliases and removes duplicates.
    public static func build(
        _ message: ReplySource, mode: ComposeMode, userAddresses: some Collection<String>, quotedBodyHTML: String,
        forwardAttachments: [DraftAttachment] = [], timeZone: TimeZone = .current
    ) -> ReplyDraft {
        let own = Set(userAddresses.map { $0.trimmingCharacters(in: .whitespaces).lowercased() })
        let sender = message.from.first
        let fromMe = sender.map { own.contains($0.address.lowercased()) } ?? false
        let subject = prefixedSubject(message.subject, mode: mode)
        // Forwards carry these too, so the sent forward stays in the original conversation (as Gmail and Apple Mail do).
        var refs = message.references
        if let id = message.messageId { refs.append(id) }
        var seen = Set<String>()
        let references = refs.filter { seen.insert($0).inserted }

        if mode == .forward {
            var lines = [
                "---------- Forwarded message ---------",
                "From: \(message.from.map(format).joined(separator: ", "))",
                "Date: \(formatWhen(message.date, timeZone: timeZone))",
                "Subject: \(message.subject)",
                "To: \(message.to.map(format).joined(separator: ", "))",
            ]
            if !message.cc.isEmpty { lines.append("Cc: \(message.cc.map(format).joined(separator: ", "))") }
            let header = lines.map(escapeHTML).joined(separator: "<br>")
            return ReplyDraft(
                to: [], cc: [], subject: subject, quotedHtml: "<div class=\"flint_forward\"><div>\(header)</div><br>\(quotedBodyHTML)</div>", inReplyTo: message.messageId,
                references: references, attachments: forwardAttachments)
        }

        let primary = fromMe ? message.to : (message.replyTo.isEmpty ? message.from : message.replyTo)
        var to = dedupe(primary, excluding: own)
        var cc: [Address] = []
        if mode == .replyAll {
            to = dedupe(primary + (fromMe ? [] : message.to), excluding: own)
            cc = dedupe(message.cc, excluding: own.union(to.map { $0.address.lowercased() }))
        }
        if to.isEmpty && !message.to.isEmpty { to = dedupe(message.to, excluding: []) }
        let who = sender.map(format) ?? "the sender"
        let header = "On \(formatWhen(message.date, timeZone: timeZone)), \(escapeHTML(who)) wrote:"
        let quoted = "<div class=\"flint_quote\"><div>\(header)</div><blockquote style=\"margin:0 0 0 0.8ex;padding-left:1ex;border-left:1px solid #ccc\">\(quotedBodyHTML)</blockquote></div>"
        return ReplyDraft(to: to, cc: cc, subject: subject, quotedHtml: quoted, inReplyTo: message.messageId, references: references, attachments: [])
    }
}
