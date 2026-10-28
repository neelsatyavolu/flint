import FlintModel
import Foundation
import Testing
@testable import FlintMail

private func node(_ type: String, _ subtype: String, number: String, params: [String: String] = [:], contentId: String? = nil,
                  disposition: String? = nil, filename: String? = nil, encoding: String? = nil, size: Int = 0, children: [BodyPart] = []) -> BodyPart {
    BodyPart(number: number, type: type, subtype: subtype, parameters: params, contentId: contentId, disposition: disposition, filename: filename, encoding: encoding, size: size, children: children)
}

@Suite("MailSync body structure")
struct MailBodyStructureTests {
    @Test func singleTextPartIsTheBodyPartOne() {
        let r = BodyStructureWalker.walk(node("text", "plain", number: "1", params: ["charset": "utf-8"], encoding: "quoted-printable"))
        #expect(r.text == [TextPart(part: "1", type: "text/plain", charset: "utf-8", encoding: "quoted-printable")])
        #expect(r.attachments.isEmpty)
    }

    @Test func nestedMultipartsAndAttachments() {
        let tree = node("multipart", "mixed", number: "", children: [
            node("multipart", "alternative", number: "1", children: [
                node("text", "plain", number: "1.1", encoding: "7bit"),
                node("text", "html", number: "1.2", params: ["charset": "iso-8859-1"], encoding: "base64"),
            ]),
            node("application", "pdf", number: "2", disposition: "attachment", filename: "invoice.pdf", encoding: "base64", size: 1234),
        ])
        let r = BodyStructureWalker.walk(tree)
        #expect(r.text.map(\.part) == ["1.1", "1.2"])
        #expect(r.text.map(\.type) == ["text/plain", "text/html"])
        #expect(r.attachments == [IngestAttachment(part: "2", filename: "invoice.pdf", contentType: "application/pdf", size: 1234, contentId: nil, inline: false)])
        #expect(r.hasRealAttachments)
    }

    @Test func cidImagesAreInlineAndNotRealAttachments() {
        let tree = node("multipart", "related", number: "", children: [
            node("text", "html", number: "1"),
            node("image", "png", number: "2", params: ["name": "logo.png"], contentId: "<logo@x>", disposition: "inline", size: 10),
        ])
        let r = BodyStructureWalker.walk(tree)
        #expect(r.attachments.first == IngestAttachment(part: "2", filename: "logo.png", contentType: "image/png", size: 10, contentId: "logo@x", inline: true))
        #expect(!r.hasRealAttachments)
    }

    @Test func namesUnnamedAttachmentsAndKeepsNamedTextFilesAsAttachments() {
        let tree = node("multipart", "mixed", number: "", children: [
            node("text", "plain", number: "1"),
            node("text", "plain", number: "2", disposition: "attachment", filename: "notes.txt"),
            node("image", "jpeg", number: "3", disposition: "attachment"),
            node("text", "calendar", number: "4"),
        ])
        let r = BodyStructureWalker.walk(tree)
        #expect(r.text.count == 1)
        #expect(r.attachments.map(\.filename) == ["notes.txt", "attachment-3.jpg", "attachment-4.ics"])
    }

    @Test func doesNotDescendIntoEmbeddedMessages() {
        let tree = node("multipart", "mixed", number: "", children: [
            node("text", "plain", number: "1"),
            node("message", "rfc822", number: "2", disposition: "attachment", size: 5, children: [node("text", "plain", number: "2.1")]),
        ])
        let r = BodyStructureWalker.walk(tree)
        #expect(r.text.count == 1)
        #expect(r.attachments.count == 1)
        #expect(r.attachments[0].contentType == "message/rfc822")
    }

    @Test func missingStructureIsEmpty() {
        #expect(BodyStructureWalker.walk(nil) == StructureInfo())
    }
}

@Suite("MailSync text decoding")
struct MailTextDecodingTests {
    @Test func declaredCharsetIsUsed() {
        #expect(TextDecoding.decode(Data([0x63, 0x61, 0x66, 0xE9]), charset: "iso-8859-1") == "café")
        #expect(TextDecoding.decode(Data("<p>héllo</p>".utf8), charset: "utf-8") == "<p>héllo</p>")
        #expect(TextDecoding.decode(Data("日本".utf8), charset: "\"UTF-8\"") == "日本")
    }

    @Test func missingOrUnknownCharsetFallsBack() {
        #expect(TextDecoding.decode(Data("plain".utf8), charset: nil) == "plain")
        #expect(TextDecoding.decode(Data("plain".utf8), charset: "x-nonsense") == "plain")
        #expect(TextDecoding.decode(Data([0x63, 0x61, 0x66, 0xE9]), charset: nil) == "café") // not UTF-8: windows-1252 fallback
    }

    @Test func bomIsStripped() {
        #expect(TextDecoding.decode(Data([0xEF, 0xBB, 0xBF, 0x68, 0x69]), charset: "utf-8") == "hi")
    }
}

@Suite("MailSync headers")
struct MailHeaderTests {
    @Test func foldedHeadersFirstValueWins() {
        let raw = "List-Unsubscribe: <https://x.example/u>,\r\n <mailto:u@x.example>\r\nList-Id: <news.x.example>\r\nlist-id: second\r\n\r\n"
        #expect(MailHeaders.parse(raw) == ["list-unsubscribe": "<https://x.example/u>, <mailto:u@x.example>", "list-id": "<news.x.example>"])
        #expect(MailHeaders.parse("") == [:])
    }

    @Test func referencesLoseTheirBrackets() {
        #expect(MailHeaders.parseReferences("<a@x> <b@y>\n <c@z>") == ["a@x", "b@y", "c@z"])
        #expect(MailHeaders.parseReferences(nil) == [])
        #expect(MailHeaders.parseReferences("garbage") == [])
    }

    @Test func bracketHelpers() {
        #expect(MailHeaders.bracketed("a@x") == "<a@x>")
        #expect(MailHeaders.bracketed("<a@x>") == "<a@x>")
        #expect(MailHeaders.unbracketed(" <a@x> ") == "a@x")
    }
}

private func folder(_ path: String, _ attrs: Set<String> = []) -> RemoteFolder {
    RemoteFolder(path: path, name: path.split(separator: "/").last.map(String.init), delimiter: "/", attributes: attrs)
}

@Suite("MailSync folder roles")
struct MailFolderRoleTests {
    private func roles(_ list: [RemoteFolder]) -> [String: MailboxRole?] {
        Dictionary(uniqueKeysWithValues: FolderRoles.classify(list).map { ($0.path, $0.role) })
    }

    @Test func specialUseAndInboxName() {
        let r = roles([
            folder("INBOX"), folder("Sent", ["sent"]), folder("Drafts", ["drafts"]), folder("Trash", ["trash"]), folder("Junk", ["junk"]),
            folder("Archive", ["archive"]), folder("All Mail", ["all"]), folder("Starred", ["flagged"]), folder("Important", ["important"]),
        ])
        #expect(r["INBOX"] == .some(.inbox) && r["Sent"] == .some(.sent) && r["Drafts"] == .some(.drafts) && r["Trash"] == .some(.trash))
        #expect(r["Junk"] == .some(.spam) && r["Archive"] == .some(.archive) && r["All Mail"] == .some(.all))
        #expect(r["Starred"] == .some(.flagged) && r["Important"] == .some(.important))
    }

    @Test func nameHeuristicsKeepOneFolderPerRole() {
        let r = roles([folder("INBOX"), folder("Sent Items"), folder("Deleted Items"), folder("Junk E-mail"), folder("Entwürfe"), folder("Sent"), folder("Projects")])
        #expect(r["Sent Items"] == .some(.sent) && r["Deleted Items"] == .some(.trash) && r["Junk E-mail"] == .some(.spam) && r["Entwürfe"] == .some(.drafts))
        #expect(r["Projects"] == .some(nil))
        #expect(r["Sent"] == .some(nil)) // second sent-like folder
    }

    @Test func specialUseBeatsNameAndUnselectableIsSkipped() {
        let list = FolderRoles.classify([folder("[Gmail]", ["noselect"]), folder("Bin", ["trash"]), folder("Trash")])
        #expect(list.map(\.path) == ["Bin", "Trash"])
        #expect(list.first { $0.path == "Bin" }?.role == .trash)
        #expect(list.first { $0.path == "Trash" }?.role == nil)
        #expect(list.first { $0.path == "Bin" }?.specialUse == "\\Trash")
    }

    @Test func gmailSystemFoldersByPath() {
        let r = roles([folder("INBOX"), folder("[Gmail]/Important"), folder("[Gmail]/Wichtig"), folder("[Google Mail]/Starred"), folder("Important")])
        #expect(r["[Gmail]/Important"] == .some(.important) && r["[Gmail]/Wichtig"] == .some(.important))
        #expect(r["[Google Mail]/Starred"] == .some(.flagged))
        #expect(r["Important"] == .some(nil))
        #expect(FolderRoles.classify([folder("[Gmail]/Importantes", ["important"])])[0].role == .important)
    }

    @Test func gmailLabelPaths() {
        let paths: [MailboxRole: String] = [.inbox: "INBOX", .sent: "[Gmail]/Sent Mail", .drafts: "[Gmail]/Drafts", .spam: "[Gmail]/Spam", .trash: "[Gmail]/Trash"]
        let out = FolderRoles.gmailLabelPaths(
            ["\\Inbox", "\\Sent", "\\Important", "\\Starred", "Work/Clients", "\\Draft", "\\Unknown", "", "Work/Clients"], pathForRole: { paths[$0] })
        #expect(out == ["INBOX", "[Gmail]/Sent Mail", "Work/Clients", "[Gmail]/Drafts"])
        #expect(FolderRoles.gmailLabelPaths(["\\Trash"], pathForRole: { _ in nil }).isEmpty)
    }
}

@Suite("MailSync envelope mapping")
struct MailEnvelopeMappingTests {
    private func base() -> RemoteEnvelope {
        RemoteEnvelope(
            uid: 7, flags: ["\\Seen", "\\Flagged"], internalDate: Date(timeIntervalSince1970: 1_790_856_000), size: 321, messageId: "<m1@x>",
            inReplyTo: "<m0@x>", subject: "Hi", date: Date(timeIntervalSince1970: 1_790_852_400),
            from: [Address(name: "Ann", address: "ann@x.org")], to: [Address(address: "me@x.org"), Address(name: "Group", address: "")],
            headers: ["references": "<m-1@x> <m0@x>", "list-id": "<l.x>", "precedence": "bulk"],
            bodyStructure: node("multipart", "mixed", number: "", children: [
                node("text", "plain", number: "1"), node("application", "zip", number: "2", disposition: "attachment", filename: "a.zip"),
            ]),
            gmail: GmailAttributes(msgid: "1234", thrid: "99", labels: ["\\Inbox", "Work"]))
    }

    @Test func mapsAGenericMessage() {
        let m = EnvelopeMapping.ingestMessage(base(), gmail: false, labelPaths: nil, now: 5)
        #expect(m.uid == 7 && m.gmMsgid == nil && m.gmThrid == nil && m.gmLabels == nil)
        #expect(m.messageId == "<m1@x>" && m.inReplyTo == "<m0@x>" && m.references == ["m-1@x", "m0@x"] && m.subject == "Hi")
        #expect(m.from == [Address(name: "Ann", address: "ann@x.org")] && m.to == [Address(address: "me@x.org")])
        #expect(m.date == 1_790_852_400_000)
        #expect(m.flags == MessageFlags(seen: true, flagged: true, answered: false, draft: false))
        #expect(m.size == 321 && m.hasAttachments && m.attachments.count == 1)
        #expect(m.headers == ["list-id": "<l.x>", "precedence": "bulk"])
    }

    @Test func addsGmailIdsAndLabelPaths() {
        let m = EnvelopeMapping.ingestMessage(base(), gmail: true, labelPaths: { $0.map { $0 == "\\Inbox" ? "INBOX" : $0 } }, now: 5)
        #expect(m.gmMsgid == "1234" && m.gmThrid == "99" && m.gmLabels == ["INBOX", "Work"])
    }

    @Test func dateFallsBackToInternalDateThenClock() {
        var env = base()
        env.date = nil
        #expect(EnvelopeMapping.ingestMessage(env, gmail: false, labelPaths: nil, now: 5).date == 1_790_856_000_000)
        env.internalDate = nil
        #expect(EnvelopeMapping.ingestMessage(env, gmail: false, labelPaths: nil, now: 6).date == 6)
    }

    @Test func bareEnvelopeMapsToDefaults() {
        let m = EnvelopeMapping.ingestMessage(RemoteEnvelope(uid: 1), gmail: false, labelPaths: nil, now: 9)
        #expect(m.subject == "" && m.from.isEmpty && m.messageId == nil && !m.flags.seen && m.size == 0 && !m.hasAttachments && m.date == 9)
    }

    @Test func flagHelpers() {
        #expect(EnvelopeMapping.flags(["\\Answered", "\\Draft"]) == MessageFlags(seen: false, flagged: false, answered: true, draft: true))
        #expect(EnvelopeMapping.flagUpdate(FlagState(uid: 3, flags: ["\\Seen"])) == FlagUpdate(uid: 3, seen: true, flagged: false, answered: false, draft: false))
    }
}

@Suite("MailSync attachment cache")
struct MailAttachmentCacheTests {
    @Test func namesAreSafe() {
        #expect(!AttachmentCache.safeFilename("../../etc/passwd").contains("/"))
        #expect(AttachmentCache.safeFilename("a\u{0}b\u{7}c.txt") == "abc.txt")
        #expect(AttachmentCache.safeFilename("  ..hidden. ") == "hidden")
        #expect(AttachmentCache.safeFilename("CON:*?.txt") == "CON_.txt")
        #expect(AttachmentCache.safeFilename("") == "attachment")
        #expect(AttachmentCache.safeFilename("...", fallback: "x") == "x")
        let long = AttachmentCache.safeFilename(String(repeating: "a", count: 300) + ".pdf")
        #expect(long.count == 120 && long.hasSuffix(".pdf"))
    }

    @Test func pathStaysInsideTheRoot() {
        let root = URL(fileURLWithPath: "/data")
        let p = AttachmentCache.path(root: root, accountId: "acc/../x", messageRowId: 5, attachmentId: 9, filename: "../evil.sh")
        #expect(p.path.hasPrefix("/data/attachments/"))
        #expect(!p.pathComponents.contains(".."))
        #expect(p.path.hasSuffix("/5/9-_evil.sh"))
    }

    @Test func writesAtomicallyAndReadsBack() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("flint-att-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        let url = dir.appendingPathComponent("x/y.bin")
        try AttachmentCache.write(Data("data".utf8), to: url)
        #expect(AttachmentCache.read(url.path) == Data("data".utf8))
        #expect(!FileManager.default.fileExists(atPath: url.appendingPathExtension("part").path))
        try AttachmentCache.write(Data("again".utf8), to: url)
        #expect(AttachmentCache.read(url.path) == Data("again".utf8))
        #expect(AttachmentCache.read(dir.appendingPathComponent("missing").path) == nil)
        #expect(AttachmentCache.read(nil) == nil)
    }
}
