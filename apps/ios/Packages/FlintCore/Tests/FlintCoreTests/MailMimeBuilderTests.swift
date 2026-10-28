import FlintModel
import Foundation
import Testing
@testable import FlintMail

private let me = Address(name: "Me", address: "me@example.com")
private let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

private func build(_ input: MimeInput) throws -> MailParsedMime { MailParsedMime.parse(try MimeBuilder.build(input)) }

@Suite("MimeBuilder")
struct MailMimeBuilderTests {
    @Test func buildsAlternativeWithDerivedTextAndAMessageId() throws {
        let raw = try MimeBuilder.build(MimeInput(
            from: me, to: [Address(name: "Ann", address: "ann@example.org")], subject: "Héllo", html: "<p>Hi <b>Ann</b></p>", messageId: "abc@example.com"))
        let parsed = MailParsedMime.parse(raw)
        #expect(parsed.header("message-id") == "<abc@example.com>")
        #expect(mailDecodeEncodedWords(parsed.header("subject") ?? "") == "Héllo")
        #expect(parsed.contentType == "multipart/alternative")
        #expect(parsed.parts.map(\.contentType) == ["text/plain", "text/html"])
        #expect(parsed.parts[0].text.contains("Hi Ann"))
        #expect(parsed.parts[1].text.contains("<b>Ann</b>"))
        #expect(parsed.header("mime-version") == "1.0")
        #expect(parsed.header("from") == "Me <me@example.com>" && parsed.header("to") == "Ann <ann@example.org>")
        let text = String(decoding: raw, as: UTF8.self)
        #expect(text.hasSuffix("\r\n") && !text.contains("\n\n") )
        #expect(raw.allSatisfy { $0 < 0x80 }) // 7-bit clean
    }

    @Test func generatesAMessageIdFromTheSendersDomain() throws {
        let parsed = try build(MimeInput(from: me, to: [], subject: "s", html: "<p>x</p>"))
        let id = try #require(parsed.header("message-id"))
        #expect(id.range(of: #"^<[0-9a-f]{32}@example\.com>$"#, options: .regularExpression) != nil)
        #expect(MimeBuilder.newMessageId(fromAddress: "x@y.org").hasSuffix("@y.org"))
        #expect(MimeBuilder.newMessageId(fromAddress: "nodomain").hasSuffix("@flint.local"))
    }

    @Test func omitsBccUnlessAskedToKeepIt() throws {
        let base = MimeInput(from: me, to: [Address(address: "a@example.org")], bcc: [Address(address: "secret@example.org")], subject: "s", html: "<p>x</p>")
        #expect(try build(base).header("bcc") == nil)
        var keep = base
        keep.keepBcc = true
        #expect(try build(keep).header("bcc") == "secret@example.org")
    }

    @Test func setsThreadingAndExtraHeaders() throws {
        let parsed = try build(MimeInput(
            from: me, to: [], subject: "Re: x", html: "<p>x</p>", inReplyTo: "<p1@x>", references: ["r0@x", "p1@x"], headers: ["X-Flint-Ref": "ref123", "Bad Name": "no"]))
        #expect(parsed.header("in-reply-to") == "<p1@x>")
        #expect(parsed.header("references") == "<r0@x> <p1@x>")
        #expect(parsed.header("x-flint-ref") == "ref123")
        #expect(parsed.header("bad name") == nil)
    }

    @Test func subjectsCannotInjectHeaders() throws {
        let parsed = try build(MimeInput(from: me, to: [], subject: "hi\r\nBcc: evil@example.org", html: "<p>x</p>"))
        #expect(parsed.header("bcc") == nil)
        #expect(parsed.header("subject") == "hi Bcc: evil@example.org")
    }

    @Test func longNonAsciiSubjectsAndNamesUseShortEncodedWords() throws {
        let subject = String(repeating: "日本語のテスト ", count: 12)
        let parsed = try build(MimeInput(from: Address(name: "José, Ñandú", address: "j@example.com"), to: [Address(name: "Zoë \"Z\"", address: "z@example.org")], subject: subject, html: "<p>x</p>"))
        let raw = String(decoding: try MimeBuilder.build(MimeInput(from: me, to: [], subject: subject, html: "x")), as: UTF8.self)
        for line in raw.components(separatedBy: "\r\n") { #expect(line.count <= 78) }
        #expect(mailDecodeEncodedWords(parsed.header("subject") ?? "") == subject.trimmingCharacters(in: .whitespaces))
        #expect(mailDecodeEncodedWords(parsed.header("from") ?? "") == "José, Ñandú <j@example.com>")
        #expect(parsed.header("to") == "\"Zoë \\\"Z\\\"\" <z@example.org>" || mailDecodeEncodedWords(parsed.header("to") ?? "").hasSuffix("<z@example.org>"))
    }

    @Test func nonAsciiBodiesAreQuotedPrintableAndRoundTrip() throws {
        let html = "<p>" + String(repeating: "naïve café — ünïcode ", count: 20) + "</p>"
        let parsed = try build(MimeInput(from: me, to: [], subject: "s", html: html, text: "plain ünï"))
        #expect(parsed.parts[0].header("content-transfer-encoding") == "quoted-printable")
        #expect(parsed.parts[0].text == "plain ünï")
        #expect(parsed.parts[1].text == html)
        let raw = String(decoding: try MimeBuilder.build(MimeInput(from: me, to: [], subject: "s", html: html)), as: UTF8.self)
        for line in raw.components(separatedBy: "\r\n") { #expect(line.count <= 78) }
    }

    @Test func plainTextModeSendsNoHtmlPart() throws {
        let parsed = try build(MimeInput(from: me, to: [], subject: "s", html: "", text: "just text"))
        #expect(parsed.contentType == "text/plain")
        #expect(parsed.text.trimmingCharacters(in: .whitespacesAndNewlines) == "just text")
    }

    @Test func usesExplicitTextWhenGiven() throws {
        let parsed = try build(MimeInput(from: me, to: [], subject: "s", html: "<p>html</p>", text: "custom text"))
        #expect(parsed.parts[0].text == "custom text")
    }

    @Test func dataImagesBecomeCidParts() throws {
        let html = "<p>Logo</p><img src=\"data:image/png;base64,\(png)\"><img src=\"data:image/png;base64,\(png)\">"
        let (rewritten, inline) = MimeBuilder.extractDataImages(html)
        #expect(inline.count == 1 && !rewritten.contains("data:image"))
        #expect(rewritten.components(separatedBy: "cid:\(inline[0].contentId)").count == 3)
        let parsed = try build(MimeInput(from: me, to: [], subject: "s", html: html))
        let leaves = parsed.flatten()
        #expect(leaves.map(\.contentType) == ["text/plain", "text/html", "image/png"])
        let cid = try #require(leaves[2].header("content-id"))
        #expect(leaves[2].disposition == "inline" && cid.hasPrefix("<img1-") && cid.hasSuffix("@flint>"))
        #expect(leaves[2].body == Data(base64Encoded: png))
        #expect(!leaves[1].text.contains("data:image"))
        #expect(leaves[1].text.contains("cid:" + cid.dropFirst().dropLast()))
    }

    @Test func htmlWithoutDataImagesIsLeftAlone() {
        let (out, inline) = MimeBuilder.extractDataImages(#"<img src="https://x.example/a.png">"#)
        #expect(inline.isEmpty && out.contains("https://x.example/a.png"))
    }

    @Test func attachesFilesAndInlineDraftAttachments() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("flint-compose-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        try Data("attached text".utf8).write(to: dir.appendingPathComponent("a.txt"))
        try Data(base64Encoded: png)!.write(to: dir.appendingPathComponent("logo.png"))
        try Data([1, 2, 3]).write(to: dir.appendingPathComponent("é.bin"))
        let parsed = try build(MimeInput(
            from: me, to: [], subject: "s", html: "<img src=\"cid:logo@flint\">",
            attachments: [
                DraftAttachment(id: "1", filename: "a.txt", contentType: "text/plain", size: 13, path: dir.appendingPathComponent("a.txt").path),
                DraftAttachment(id: "2", filename: "logo.png", contentType: "image/png", size: 70, path: dir.appendingPathComponent("logo.png").path, inline: true, contentId: "<logo@flint>"),
                DraftAttachment(id: "3", filename: "é.bin", contentType: "application/octet-stream", size: 3, path: dir.appendingPathComponent("é.bin").path),
            ]))
        #expect(parsed.contentType == "multipart/mixed")
        let leaves = parsed.flatten()
        let a = try #require(leaves.first { $0.filename == "a.txt" })
        #expect(a.text == "attached text" && a.disposition == "attachment")
        let logo = try #require(leaves.first { $0.filename == "logo.png" })
        #expect(logo.header("content-id") == "<logo@flint>" && logo.disposition == "inline")
        let accented = try #require(leaves.first { $0.filename == "é.bin" })
        #expect(accented.body == Data([1, 2, 3]))
    }

    @Test func aMissingAttachmentFileIsAReadableError() {
        let missing = DraftAttachment(id: "1", filename: "gone.pdf", contentType: "application/pdf", size: 1, path: "/nonexistent/gone.pdf")
        #expect(throws: FlintError.self) { try MimeBuilder.build(MimeInput(from: me, to: [], subject: "s", html: "x", attachments: [missing])) }
        do { _ = try MimeBuilder.build(MimeInput(from: me, to: [], subject: "s", html: "x", attachments: [missing])) } catch let error as FlintError {
            #expect(error.code == .notFound && error.message.contains("gone.pdf"))
        } catch { Issue.record("wrong error") }
    }

    @Test func aMessageWithoutASenderIsRejected() {
        #expect(throws: FlintError.self) { try MimeBuilder.build(MimeInput(from: Address(address: ""), to: [], subject: "s", html: "x")) }
    }

    @Test func tracksCopiesDifferOnlyInThePixel() throws {
        var input = MimeInput(from: me, to: [Address(address: "a@example.org")], subject: "s", html: "<body><p>hi</p></body>", messageId: "same@example.com", date: Date(timeIntervalSince1970: 1_800_000_000))
        let plain = try MimeBuilder.build(input)
        input.html = "<body><img src=\"https://r.example/i/AAAAAAAAAAAAAAAAAAAAAA.gif\"><p>hi</p></body>"
        let tracked = try MimeBuilder.build(input)
        let a = MailParsedMime.parse(plain), b = MailParsedMime.parse(tracked)
        #expect(a.header("message-id") == b.header("message-id") && a.header("date") == b.header("date"))
        #expect(a.parts[0].text == b.parts[0].text) // same text alternative
    }
}

@Suite("MIME encoders")
struct MailMimeEncodingTests {
    @Test func foldsHeadersAtWhitespace() {
        let value = Array(repeating: "word", count: 40).joined(separator: " ")
        let folded = MimeEncoding.foldedHeader("Subject", value)
        #expect(folded.components(separatedBy: "\r\n").allSatisfy { $0.count <= 76 })
        #expect(folded.replacingOccurrences(of: "\r\n ", with: " ") == "Subject: " + value)
    }

    @Test func quotedPrintableEscapesTrailingSpacesAndEquals() {
        #expect(MimeEncoding.quotedPrintable("a=b \nend") == "a=3Db=20\r\nend")
        #expect(mailDecodeQuotedPrintable(MimeEncoding.quotedPrintable("é=ok\n")) == Data("é=ok\r\n".utf8) || String(decoding: mailDecodeQuotedPrintable(MimeEncoding.quotedPrintable("é=ok")), as: UTF8.self) == "é=ok")
        let long = String(repeating: "x", count: 200)
        #expect(MimeEncoding.quotedPrintable(long).components(separatedBy: "\r\n").allSatisfy { $0.count <= 76 })
    }

    @Test func plainTextFromHtml() {
        #expect(PlainText.fromHTML("<p>Hi&nbsp;<b>Ann</b></p><p>Second &amp; last &#169;</p><br>end") == "Hi Ann\nSecond & last ©\n\nend")
        #expect(PlainText.fromHTML("<style>p{color:red}</style><script>x()</script><div>a</div><ul><li>one</li><li>two</li></ul>") == "a\n- one\n- two")
        #expect(PlainText.fromHTML("<head>\n<style>\np { color: red }\n</style></head>\n<body><script>\nvar x = 1;\n</script><p>kept</p></body>") == "kept")
    }
}

@Suite("MimeBuilder calendar part")
struct MailMimeCalendarPartTests {
    private let ics = "BEGIN:VCALENDAR\r\nMETHOD:REPLY\r\nEND:VCALENDAR\r\n"

    @Test func writesTheReplyAsATextCalendarAlternative() throws {
        let part = CalendarPart(method: "REPLY", content: ics)
        let parsed = try build(MimeInput(from: me, to: [Address(address: "org@example.org")], subject: "Accepted: x", html: "<p>ok</p>", calendarPart: part))
        #expect(parsed.contentType == "multipart/alternative")
        #expect(parsed.parts.map(\.contentType) == ["text/plain", "text/html", "text/calendar"])
        let calendar = parsed.parts[2]
        #expect(calendar.parameters["method"] == "REPLY" && calendar.parameters["charset"]?.lowercased() == "utf-8")
        #expect(calendar.text.contains("METHOD:REPLY"))
        #expect(calendar.disposition == nil)
    }

    @Test func keepsOrdinaryAttachmentsInMixed() throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("cal-\(UUID().uuidString).txt")
        try Data("hello".utf8).write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }
        let attachment = DraftAttachment(id: "a", filename: "n.txt", contentType: "text/plain", size: 5, path: file.path)
        let parsed = try build(MimeInput(
            from: me, to: [], subject: "s", html: "<p>x</p>", attachments: [attachment], calendarPart: CalendarPart(method: "REPLY", content: ics)))
        #expect(parsed.contentType == "multipart/mixed")
        #expect(parsed.parts[0].parts.map(\.contentType) == ["text/plain", "text/html", "text/calendar"])
        #expect(parsed.parts[1].filename == "n.txt")
    }

    @Test func promotesAnIcsAttachmentWhoseTypeCarriesAMethod() throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("cal-\(UUID().uuidString).ics")
        try Data(ics.utf8).write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }
        let attachment = DraftAttachment(id: "a", filename: "invite.ics", contentType: CalendarPart.contentType(method: "REPLY"), size: ics.utf8.count, path: file.path)
        let parsed = try build(MimeInput(from: me, to: [], subject: "s", html: "<p>x</p>", attachments: [attachment]))
        #expect(parsed.contentType == "multipart/alternative")
        #expect(parsed.parts.last?.contentType == "text/calendar" && parsed.parts.last?.parameters["method"] == "REPLY")
        #expect(parsed.parts.last?.text.contains("METHOD:REPLY") == true)
    }

    @Test func aPlainIcsAttachmentWithoutAMethodStaysAnAttachment() throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("cal-\(UUID().uuidString).ics")
        try Data(ics.utf8).write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }
        let attachment = DraftAttachment(id: "a", filename: "event.ics", contentType: "text/calendar", size: 10, path: file.path)
        let parsed = try build(MimeInput(from: me, to: [], subject: "s", html: "<p>x</p>", attachments: [attachment]))
        #expect(parsed.contentType == "multipart/mixed")
        #expect(parsed.parts[1].filename == "event.ics")
    }

    @Test func sevenBitCleanWithNonAsciiContent() throws {
        let raw = try MimeBuilder.build(MimeInput(
            from: me, to: [], subject: "s", html: "<p>x</p>", calendarPart: CalendarPart(method: "REPLY", content: "SUMMARY:Café\r\n")))
        #expect(raw.allSatisfy { $0 < 0x80 })
        #expect(MailParsedMime.parse(raw).parts.last?.text.contains("Café") == true)
    }
}
