import FlintMail
import FlintModel
import Foundation

/// One fictional message in the demo mailbox, before it becomes an IMAP envelope. Everything here is invented: names,
/// addresses (example.* domains only) and text.
struct SeedMessage: Sendable {
    enum Box: Sendable { case inbox, sent, archive, trash }

    struct Attachment: Sendable {
        var filename: String
        var contentType: String
        var data: Data
    }

    /// Stable key. The Message-ID is `<key@seed.example>`; replies name their parents by key.
    var key: String
    var box: Box = .inbox
    var from: Address
    var to: [Address]
    var cc: [Address] = []
    var subject: String
    var text: String
    var html: String?
    /// How long before "now" the message arrived.
    var minutesAgo: Int
    var unread = false
    var headers: [String: String] = [:]
    var attachments: [Attachment] = []
    /// Keys of earlier messages in the conversation, oldest first.
    var replyTo: [String] = []

    var messageId: String { "<\(key)@seed.example>" }
    var threadKey: String { replyTo.first ?? key }
}

/// Turns a `SeedMessage` into what a server holds: an envelope, its body parts and a BODYSTRUCTURE.
enum SeedMessageBuilder {
    struct Built {
        var envelope: RemoteEnvelope
        var parts: [String: Data]
    }

    static func build(_ message: SeedMessage, now: Date, seen: Bool, gmail: GmailAttributes?) -> Built {
        let date = now.addingTimeInterval(-Double(message.minutesAgo) * 60)
        var headers = message.headers
        if !message.replyTo.isEmpty {
            headers["references"] = message.replyTo.map { "<\($0)@seed.example>" }.joined(separator: " ")
        }
        let (structure, parts) = structureAndParts(message)
        var envelope = RemoteEnvelope(
            uid: 0, flags: seen ? [IMAPFlag.seen] : [], internalDate: date, size: parts.values.reduce(0) { $0 + $1.count },
            messageId: message.messageId, inReplyTo: message.replyTo.last.map { "<\($0)@seed.example>" }, subject: message.subject, date: date,
            from: [message.from], to: message.to, cc: message.cc, headers: headers, bodyStructure: structure, gmail: gmail)
        envelope.size = max(envelope.size, 1)
        return Built(envelope: envelope, parts: parts)
    }

    private static func structureAndParts(_ message: SeedMessage) -> (BodyPart, [String: Data]) {
        var parts: [String: Data] = [:]
        let utf8 = ["charset": "utf-8"]
        func leaf(_ number: String, _ subtype: String, _ content: String) -> BodyPart {
            let data = Data(content.utf8)
            parts[number] = data
            return BodyPart(number: number, type: "text", subtype: subtype, parameters: utf8, encoding: "8bit", size: data.count)
        }
        let body: BodyPart
        let prefix = message.attachments.isEmpty ? "" : "1."
        if let html = message.html {
            body = BodyPart(
                number: message.attachments.isEmpty ? "" : "1", type: "multipart", subtype: "alternative",
                children: [leaf(prefix + "1", "plain", message.text), leaf(prefix + "2", "html", html)])
        } else {
            body = leaf("1", "plain", message.text)
        }
        guard !message.attachments.isEmpty else { return (body, parts) }
        var children = [body]
        for (index, attachment) in message.attachments.enumerated() {
            let number = String(index + 2)
            parts[number] = attachment.data
            let pieces = attachment.contentType.split(separator: "/", maxSplits: 1).map(String.init)
            children.append(BodyPart(
                number: number, type: pieces[0], subtype: pieces.count > 1 ? pieces[1] : "octet-stream",
                parameters: ["name": attachment.filename], disposition: "attachment", filename: attachment.filename, encoding: "base64",
                size: attachment.data.count))
        }
        return (BodyPart(number: "", type: "multipart", subtype: "mixed", children: children), parts)
    }
}
