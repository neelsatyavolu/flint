// Builds a complete RFC 5322 message: multipart/alternative (text and html), inline cid images, attachments, threading
// headers. Port of buildMime in packages/core/src/mail/compose.ts.
//
// Layout (single-child containers collapse):
//   multipart/mixed
//     multipart/alternative
//       text/plain
//       multipart/related
//         text/html
//         inline images (Content-ID)
//     attachments

import FlintModel
import Foundation

public struct MimeInput: Sendable {
    public var from: Address
    public var to: [Address]
    public var cc: [Address]
    public var bcc: [Address]
    public var replyTo: [Address]
    public var subject: String
    public var html: String
    /// Derived from `html` when nil.
    public var text: String?
    public var attachments: [DraftAttachment]
    /// Without angle brackets. Generated from the sender's domain when nil.
    public var messageId: String?
    public var inReplyTo: String?
    public var references: [String]
    /// Extra headers (`X-Flint-Ref`), written in name order.
    public var headers: [String: String]
    public var date: Date?
    /// Keep the Bcc header (the copy saved to Sent and Drafts). Never set for mail sent over SMTP.
    public var keepBcc: Bool
    /// An iTIP message (RFC 6047) written as a `text/calendar; method=...` alternative after the html. When nil, the first
    /// attachment whose type is `CalendarPart.contentType(method:)` is promoted to it (see `MimeBuilder.build`).
    public var calendarPart: CalendarPart?

    public init(
        from: Address, to: [Address], cc: [Address] = [], bcc: [Address] = [], replyTo: [Address] = [], subject: String, html: String, text: String? = nil,
        attachments: [DraftAttachment] = [], messageId: String? = nil, inReplyTo: String? = nil, references: [String] = [], headers: [String: String] = [:],
        date: Date? = nil, keepBcc: Bool = false, calendarPart: CalendarPart? = nil
    ) {
        self.from = from
        self.to = to
        self.cc = cc
        self.bcc = bcc
        self.replyTo = replyTo
        self.subject = subject
        self.html = html
        self.text = text
        self.attachments = attachments
        self.messageId = messageId
        self.inReplyTo = inReplyTo
        self.references = references
        self.headers = headers
        self.date = date
        self.keepBcc = keepBcc
        self.calendarPart = calendarPart
    }
}

/// The calendar body of an iTIP message such as a REPLY. `method` is the METHOD of the iCalendar object.
public struct CalendarPart: Hashable, Sendable {
    public var method: String
    public var content: String

    public init(method: String, content: String) {
        self.method = method
        self.content = content
    }

    /// The type a draft attachment carries to ask for the alternative part instead of a file.
    public static func contentType(method: String) -> String { "text/calendar; method=\(method.uppercased()); charset=UTF-8" }

    /// The METHOD in an attachment type like `text/calendar; method=REPLY`, nil for any other type.
    static func method(inContentType type: String) -> String? {
        let pieces = type.split(separator: ";").map { $0.trimmingCharacters(in: .whitespaces) }
        guard pieces.first?.lowercased() == "text/calendar" else { return nil }
        for piece in pieces.dropFirst() {
            let pair = piece.split(separator: "=", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
            if pair.count == 2, pair[0].lowercased() == "method" {
                let value = pair[1].trimmingCharacters(in: CharacterSet(charactersIn: "\""))
                return value.isEmpty ? nil : value.uppercased()
            }
        }
        return nil
    }
}

public struct InlineImage: Hashable, Sendable {
    public var contentId: String
    public var filename: String
    public var contentType: String
    public var data: Data
}

public enum MimeBuilder {
    public typealias AttachmentLoader = @Sendable (DraftAttachment) throws -> Data

    /// Reads an attachment from `DraftAttachment.path`.
    public static let fileLoader: AttachmentLoader = { attachment in
        do { return try Data(contentsOf: URL(fileURLWithPath: attachment.path)) } catch {
            throw FlintError(.notFound, "The attachment \"\(attachment.filename)\" isn't available any more. Remove it and add it again.")
        }
    }

    public static func newMessageId(fromAddress: String) -> String {
        let domain = fromAddress.split(separator: "@", maxSplits: 1).dropFirst().first.map(String.init) ?? "flint.local"
        let random = (0..<16).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
        return "\(random)@\(domain.isEmpty ? "flint.local" : domain)"
    }

    private static let dataImage = try! NSRegularExpression(
        pattern: #"(<img\b[^>]*?\bsrc\s*=\s*)(["'])(data:(image/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+))\2"#, options: [.caseInsensitive])

    /// Replaces inline `data:` images with `cid:` references and returns the matching inline parts, in document order.
    public static func extractDataImages(_ html: String) -> (html: String, inline: [InlineImage]) {
        var inline: [InlineImage] = []
        var known: [String: String] = [:]
        var edits: [(range: Range<String.Index>, replacement: String)] = []
        for match in dataImage.matches(in: html, range: NSRange(html.startIndex..., in: html)) {
            guard let whole = Range(match.range, in: html), let prefix = Range(match.range(at: 1), in: html), let quote = Range(match.range(at: 2), in: html),
                  let type = Range(match.range(at: 4), in: html), let payload = Range(match.range(at: 5), in: html) else { continue }
            let clean = String(html[payload]).filter { !$0.isWhitespace }
            guard let data = Data(base64Encoded: clean) else { continue }
            let cid: String
            if let existing = known[clean] {
                cid = existing
            } else {
                let random = (0..<6).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
                cid = "img\(inline.count + 1)-\(random)@flint"
                known[clean] = cid
                let mediaType = String(html[type]).lowercased()
                let ext = mediaType.split(separator: "/").last.flatMap { $0.split(separator: "+").first }.map(String.init) ?? "png"
                inline.append(InlineImage(contentId: cid, filename: "image\(inline.count + 1).\(ext)", contentType: mediaType, data: data))
            }
            edits.append((whole, "\(html[prefix])\(html[quote])cid:\(cid)\(html[quote])"))
        }
        var out = html
        for edit in edits.reversed() { out.replaceSubrange(edit.range, with: edit.replacement) }
        return (out, inline)
    }

    private static func boundary() -> String {
        "----=_Part_" + (0..<8).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
    }

    private static func dateHeader(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss Z"
        return formatter.string(from: date)
    }

    private struct Part {
        var headers: [String]
        var body: String
        func render() -> String { (headers + ["", body]).joined(separator: MimeEncoding.crlf) }
    }

    private static func textPart(_ type: String, _ text: String) -> Part {
        let encoding = MimeEncoding.transferEncoding(for: text)
        let body = encoding == "7bit" ? MimeEncoding.crlfText(text) : MimeEncoding.quotedPrintable(text)
        return Part(headers: ["Content-Type: \(type); charset=utf-8", "Content-Transfer-Encoding: \(encoding)"], body: body)
    }

    private static func binaryPart(_ contentType: String, name: String, disposition: String, contentId: String?, data: Data) -> Part {
        let safeType = MimeEncoding.sanitizedValue(contentType).isEmpty ? "application/octet-stream" : MimeEncoding.sanitizedValue(contentType)
        var headers = [
            MimeEncoding.foldedHeader("Content-Type", "\(safeType); \(MimeEncoding.parameter("name", name))"),
            MimeEncoding.foldedHeader("Content-Disposition", "\(disposition); \(MimeEncoding.parameter("filename", name))"),
            "Content-Transfer-Encoding: base64",
        ]
        if let contentId { headers.append("Content-ID: <\(MimeEncoding.sanitizedValue(contentId))>") }
        return Part(headers: headers, body: MimeEncoding.base64Lines(data))
    }

    private static func multipart(_ subtype: String, _ parts: [Part]) -> Part {
        if parts.count == 1 { return parts[0] }
        let mark = boundary()
        var body = ""
        for part in parts { body += "--\(mark)\(MimeEncoding.crlf)\(part.render())\(MimeEncoding.crlf)" }
        body += "--\(mark)--"
        return Part(headers: ["Content-Type: multipart/\(subtype); boundary=\"\(mark)\""], body: body)
    }

    /// The finished message. Throws when an attachment cannot be read or the sender is missing.
    public static func build(_ input: MimeInput, loader: AttachmentLoader = fileLoader, now: Date = Date()) throws -> Data {
        guard !input.from.address.isEmpty else { throw FlintError(.invalid, "The message has no sender.") }
        let (html, inline) = extractDataImages(input.html)
        let text = input.text ?? PlainText.fromHTML(html)

        var attachments = input.attachments
        var calendar = input.calendarPart
        if calendar == nil, let index = attachments.firstIndex(where: { $0.inline != true && CalendarPart.method(inContentType: $0.contentType) != nil }) {
            let promoted = attachments.remove(at: index)
            let data = try loader(promoted)
            calendar = CalendarPart(method: CalendarPart.method(inContentType: promoted.contentType) ?? "REPLY", content: String(decoding: data, as: UTF8.self))
        }

        var alternatives: [Part] = [textPart("text/plain", text)]
        if !html.isEmpty {
            var related: [Part] = [textPart("text/html", html)]
            for image in inline { related.append(binaryPart(image.contentType, name: image.filename, disposition: "inline", contentId: image.contentId, data: image.data)) }
            alternatives.append(multipart("related", related))
        }
        if let calendar {
            alternatives.append(textPart("text/calendar; method=\(MimeEncoding.sanitizedValue(calendar.method).uppercased())", calendar.content))
        }
        var mixed: [Part] = [multipart("alternative", alternatives)]
        for attachment in attachments {
            let data = try loader(attachment)
            let isInline = attachment.inline == true && attachment.contentId != nil
            mixed.append(binaryPart(
                attachment.contentType, name: attachment.filename, disposition: isInline ? "inline" : "attachment",
                contentId: isInline ? attachment.contentId.map(MailHeaders.unbracketed) : nil, data: data))
        }
        let root = multipart("mixed", mixed)

        let messageId = input.messageId.map(MailHeaders.unbracketed) ?? newMessageId(fromAddress: input.from.address)
        var headers = [
            MimeEncoding.foldedHeader("From", MimeEncoding.addressHeaderValue([input.from])),
            MimeEncoding.foldedHeader("To", MimeEncoding.addressHeaderValue(input.to)),
        ]
        if !input.cc.isEmpty { headers.append(MimeEncoding.foldedHeader("Cc", MimeEncoding.addressHeaderValue(input.cc))) }
        if input.keepBcc && !input.bcc.isEmpty { headers.append(MimeEncoding.foldedHeader("Bcc", MimeEncoding.addressHeaderValue(input.bcc))) }
        if !input.replyTo.isEmpty { headers.append(MimeEncoding.foldedHeader("Reply-To", MimeEncoding.addressHeaderValue(input.replyTo))) }
        if input.to.isEmpty { headers.removeAll { $0.hasPrefix("To:") } }
        headers.append(MimeEncoding.foldedHeader("Subject", MimeEncoding.encodedWords(MimeEncoding.sanitizedValue(input.subject))))
        headers.append("Date: \(dateHeader(input.date ?? now))")
        headers.append("Message-ID: <\(messageId)>")
        if let reply = input.inReplyTo, !reply.isEmpty { headers.append("In-Reply-To: \(MailHeaders.bracketed(reply))") }
        if !input.references.isEmpty { headers.append(MimeEncoding.foldedHeader("References", input.references.map(MailHeaders.bracketed).joined(separator: " "))) }
        for name in input.headers.keys.sorted() {
            guard let value = input.headers[name], name.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") }) else { continue }
            headers.append(MimeEncoding.foldedHeader(name, MimeEncoding.encodedWords(MimeEncoding.sanitizedValue(value))))
        }
        headers.append("MIME-Version: 1.0")
        let message = (headers + root.headers + ["", root.body]).joined(separator: MimeEncoding.crlf) + MimeEncoding.crlf
        return Data(message.utf8)
    }
}
