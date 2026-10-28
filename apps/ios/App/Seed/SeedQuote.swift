import FlintModel
import Foundation

/// Builds the text a mail client adds when replying: an attribution line and the parent message quoted below.
enum SeedQuote {
    static func attribution(of parent: SeedMessage, now: Date) -> String {
        let date = now.addingTimeInterval(-Double(parent.minutesAgo) * 60)
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "EEE, MMM d, yyyy 'at' h:mm a"
        let name = parent.from.name.isEmpty ? parent.from.address : parent.from.name
        return "On \(formatter.string(from: date)) \(name) <\(parent.from.address)> wrote:"
    }

    static func quoted(_ text: String) -> String {
        text.split(separator: "\n", omittingEmptySubsequences: false).map { $0.isEmpty ? ">" : "> \($0)" }.joined(separator: "\n")
    }

    /// Plain text of a reply: the new text, then the attribution and the parent quoted.
    static func replyText(_ body: String, parent: SeedMessage, now: Date) -> String {
        "\(body)\n\n\(attribution(of: parent, now: now))\n\(quoted(parent.text))"
    }

    /// HTML of a reply, with the parent in a `blockquote type="cite"` like Apple Mail and Gmail write.
    static func replyHTML(_ body: String, parent: SeedMessage, now: Date) -> String {
        let paragraphs = body.split(separator: "\n\n").map { "<p>\(escape(String($0)))</p>" }.joined()
        let inner = parent.html ?? parent.text.split(separator: "\n\n").map { "<p>\(escape(String($0)))</p>" }.joined()
        return "<div>\(paragraphs)</div><br><div>\(escape(attribution(of: parent, now: now)))</div><blockquote type=\"cite\">\(inner)</blockquote>"
    }

    static func escape(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;")
    }

    /// A reply to `parent`, from `from`, `minutesAgo` before now. Both plain text and HTML carry the quote.
    static func reply(
        key: String, to parent: SeedMessage, from: Address, recipients: [Address], body: String, minutesAgo: Int, now: Date,
        unread: Bool = false, box: SeedMessage.Box = .inbox, subject: String? = nil
    ) -> SeedMessage {
        let base = subject ?? (parent.subject.lowercased().hasPrefix("re:") ? parent.subject : "Re: \(parent.subject)")
        return SeedMessage(
            key: key, box: box, from: from, to: recipients, subject: base,
            text: replyText(body, parent: parent, now: now), html: replyHTML(body, parent: parent, now: now),
            minutesAgo: minutesAgo, unread: unread, replyTo: parent.replyTo + [parent.key])
    }
}
