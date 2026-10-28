@testable import Flint
import FlintModel
import Foundation
import SwiftUI
import Testing

@Suite("Composer: recipients")
struct RecipientParsingTests {
    @Test("bare, bracketed and named addresses")
    func forms() {
        #expect(RecipientParsing.parseAddress("ann@example.com") == Address(address: "ann@example.com"))
        #expect(RecipientParsing.parseAddress("<ann@example.com>") == Address(address: "ann@example.com"))
        #expect(RecipientParsing.parseAddress("Ann Lee <ann@example.com>") == Address(name: "Ann Lee", address: "ann@example.com"))
        #expect(RecipientParsing.parseAddress("\"Lee, Ann\" <ann@example.com>")?.name == "Lee, Ann")
        #expect(RecipientParsing.parseAddress("ann") == nil)
        #expect(RecipientParsing.parseAddress("ann@x") == nil)
    }

    @Test("a pasted list splits on commas, semicolons and newlines outside quotes")
    func lists() {
        let parsed = RecipientParsing.parseList("a@b.co, \"Lee, Ann\" <ann@example.com>; nope\nc@d.io")
        #expect(parsed.addresses.map(\.address) == ["a@b.co", "ann@example.com", "c@d.io"])
        #expect(parsed.invalid == ["nope"])
    }

    @Test("merging skips repeats in any case and removing ignores case")
    func mergeRemove() {
        let list = [Address(address: "Ann@Example.com")]
        let merged = RecipientParsing.merged(list, with: [Address(address: "ann@example.com"), Address(address: "bo@example.com")])
        #expect(merged.map(\.address) == ["Ann@Example.com", "bo@example.com"])
        #expect(RecipientParsing.removing("ANN@example.com", from: merged).map(\.address) == ["bo@example.com"])
    }
}

@Suite("Composer: send checks")
struct SendChecksTests {
    private let ann = [Address(address: "ann@example.com")]

    @Test("no recipient blocks, then a missing subject and a mentioned attachment can be confirmed past")
    func order() {
        #expect(SendChecks.check(to: [], cc: [], bcc: [], subject: "Hi", body: "", attachmentCount: 0) == .noRecipients)
        #expect(SendChecks.check(to: ann, cc: [], bcc: [], subject: "  ", body: "", attachmentCount: 0) == .confirm(.noSubject))
        #expect(SendChecks.check(to: ann, cc: [], bcc: [], subject: "Hi", body: "see attached", attachmentCount: 0) == .confirm(.noAttachment))
        #expect(SendChecks.check(to: [], cc: [], bcc: ann, subject: "Hi", body: "see attached", attachmentCount: 1) == .ok)
        #expect(SendChecks.check(to: ann, cc: [], bcc: [], subject: "", body: "attached", attachmentCount: 0, skip: [.noSubject, .noAttachment]) == .ok)
    }

    @Test("bare attach needs an object")
    func mentions() {
        #expect(SendChecks.mentionsAttachment("I attach the deck"))
        #expect(SendChecks.mentionsAttachment("Two attachments below"))
        #expect(!SendChecks.mentionsAttachment("that attach no meaning"))
        #expect(!SendChecks.mentionsAttachment("nothing here"))
    }

    @Test("receipt blockers: off, no endpoint, plain text, only me")
    func blockers() {
        var settings = Settings()
        settings.receipts.endpoint = "https://receipts.example.com"
        let others = [Address(address: "ann@example.com")]
        #expect(SendChecks.receiptBlocker(settings: nil, recipients: others, selfAddresses: []) == nil)
        #expect(SendChecks.receiptBlocker(settings: settings, recipients: others, selfAddresses: []) == nil)
        #expect(SendChecks.receiptBlocker(settings: settings, recipients: others, selfAddresses: ["Ann@example.com"]) != nil)
        settings.compose.plainTextOnly = true
        #expect(SendChecks.receiptBlocker(settings: settings, recipients: others, selfAddresses: []) != nil)
        settings.compose.plainTextOnly = false
        settings.receipts.endpoint = " "
        #expect(SendChecks.receiptBlocker(settings: settings, recipients: others, selfAddresses: []) != nil)
        settings.receipts.enabled = false
        #expect(SendChecks.receiptBlocker(settings: settings, recipients: others, selfAddresses: []) != nil)
    }
}

@Suite("Composer: signatures")
struct SignatureRulesTests {
    private let shared = Signature(id: 1, name: "Shared", html: "Maya", accountIds: [], defaultNew: true, defaultReply: false)
    private let work = Signature(id: 2, name: "Work", html: "Maya, Northwind", accountIds: ["w"], defaultNew: true, defaultReply: true)

    @Test("the account's own default beats the shared one, replies use the reply flag")
    func defaults() {
        let all = [shared, work]
        #expect(SignatureRules.defaultSignature(all: all, settings: nil, accountId: "w", mode: .new)?.id == 2)
        #expect(SignatureRules.defaultSignature(all: all, settings: nil, accountId: "p", mode: .new)?.id == 1)
        #expect(SignatureRules.defaultSignature(all: all, settings: nil, accountId: "p", mode: .reply) == nil)
        #expect(SignatureRules.defaultSignature(all: all, settings: nil, accountId: "w", mode: .forward)?.id == 2)
    }

    @Test("settings win: a chosen id, or null for none")
    func settings() {
        var settings = Settings()
        let none: Int? = nil
        settings.compose.defaultSignatureByAccount = ["w": 1, "p": none]
        let all = [shared, work]
        #expect(SignatureRules.defaultSignature(all: all, settings: settings, accountId: "w", mode: .new)?.id == 1)
        #expect(SignatureRules.defaultSignature(all: all, settings: settings, accountId: "p", mode: .new) == nil)
        settings.compose.defaultReplySignatureByAccount = ["w": 2 as Int?]
        #expect(SignatureRules.defaultSignature(all: all, settings: settings, accountId: "w", mode: .reply)?.id == 2)
        settings.compose.defaultSignatureByAccount = ["w": 99 as Int?]
        #expect(SignatureRules.defaultSignature(all: all, settings: settings, accountId: "w", mode: .new)?.id == 2)
    }

    @Test("the block goes one line below the body and splits back out")
    func roundTrip() {
        let html = SignatureRules.compose(body: "<div>Hello</div>", signature: work)
        #expect(html == "<div>Hello</div><br><div class=\"flint_signature\" data-signature-id=\"2\">Maya, Northwind</div>")
        let parts = SignatureRules.split(html)
        #expect(parts.body == "<div>Hello</div>")
        #expect(parts.signatureHTML == "Maya, Northwind")
        #expect(parts.signatureId == 2)
        #expect(SignatureRules.split("<div>Plain</div>").signatureHTML == nil)
        #expect(SignatureRules.compose(body: "<div>Hello</div>", signature: nil) == "<div>Hello</div>")
    }

    @Test("a signature with nested divs splits at its own closing tag")
    func nested() {
        let html = "<div>Hi</div><br><div class=\"flint_signature\" data-signature-id=\"3\"><div>A</div><div>B</div></div><p>after</p>"
        let parts = SignatureRules.split(html)
        #expect(parts.signatureHTML == "<div>A</div><div>B</div>")
        #expect(parts.body == "<div>Hi</div><p>after</p>")
    }

    @Test("only signatures for the account or for every account are offered")
    func available() {
        #expect(SignatureRules.available([shared, work], for: "p").map(\.id) == [1])
        #expect(SignatureRules.available([shared, work], for: "w").map(\.id) == [1, 2])
    }
}

@Suite("Composer: send countdown")
struct SendCountdownTests {
    @Test("the bar drains from full to empty and the label counts down")
    func drains() {
        let start = Date(timeIntervalSince1970: 1_000)
        let countdown = SendCountdown(startedAt: start, undoUntil: 1_010_000)
        #expect(countdown.duration == 10)
        #expect(countdown.fraction(at: start) == 1)
        #expect(abs(countdown.fraction(at: start.addingTimeInterval(2.5)) - 0.75) < 0.0001)
        #expect(countdown.fraction(at: start.addingTimeInterval(11)) == 0)
        #expect(countdown.message(at: start.addingTimeInterval(2.5)) == "Sending in 8s")
        #expect(countdown.message(at: start.addingTimeInterval(10)) == "Sent")
    }

    @Test("a window that is already closed has nothing to drain")
    func closed() {
        let countdown = SendCountdown(startedAt: Date(timeIntervalSince1970: 100), undoUntil: 50_000)
        #expect(countdown.duration == 0)
        #expect(countdown.fraction(at: Date(timeIntervalSince1970: 100)) == 0)
    }
}

@Suite("Composer: staging")
struct ComposerStagingTests {
    @Test("staged data is written under a safe name and removed with its folder")
    func writeRemove() throws {
        let url = try ComposerStaging.write(Data("hi".utf8), filename: "a/b:c.txt")
        #expect(url.lastPathComponent == "a-b-c.txt")
        #expect(FileManager.default.fileExists(atPath: url.path))
        ComposerStaging.remove(url)
        #expect(!FileManager.default.fileExists(atPath: url.path))
        #expect(ComposerStaging.safeName("  ") == "Attachment")
        #expect(ComposerStaging.photoName(index: 2, fileExtension: "heic") == "Photo 2.heic")
        #expect(ComposerStaging.photoName(index: 1, fileExtension: nil) == "Photo 1.jpg")
    }
}
