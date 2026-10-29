import FlintModel
import Foundation
import Testing
@testable import FlintMail

private let me = Address(name: "Me", address: "me@example.com")
private let utc = TimeZone(identifier: "UTC")!
private let own = ["me@example.com", "ALIAS@example.com"]

private func source(
    from: [Address] = [Address(name: "Carla", address: "carla@example.org")], to: [Address] = [me, Address(name: "Dan", address: "dan@example.org")],
    cc: [Address] = [Address(name: "Eve", address: "eve@example.org"), Address(name: "Me alias", address: "alias@example.com")], replyTo: [Address] = []
) -> ReplySource {
    ReplySource(from: from, to: to, cc: cc, replyTo: replyTo, subject: "Plan", date: 1_791_237_840_000, messageId: "m1@example.org", references: ["m0@example.org"])
}

private func build(_ message: ReplySource, _ mode: ComposeMode, body: String = "<p>Original <b>text</b></p>", attachments: [DraftAttachment] = []) -> ReplyDraft {
    ReplyDraftBuilder.build(message, mode: mode, userAddresses: own, quotedBodyHTML: body, forwardAttachments: attachments, timeZone: utc)
}

@Suite("ReplyDraft")
struct MailReplyDraftTests {
    @Test func prefixesWithoutStacking() {
        let cases: [(String, ComposeMode, String)] = [
            ("Plan", .reply, "Re: Plan"), ("Re: Plan", .reply, "Re: Plan"), ("RE: Re: Plan", .replyAll, "Re: Plan"), ("AW: Plan", .reply, "Re: Plan"),
            ("Plan", .forward, "Fwd: Plan"), ("Fwd: Plan", .forward, "Fwd: Plan"), ("FW: FW: Plan", .forward, "Fwd: Plan"), ("Re: Plan", .forward, "Fwd: Re: Plan"),
            ("Fwd: Plan", .reply, "Re: Fwd: Plan"),
        ]
        for (subject, mode, expected) in cases { #expect(ReplyDraftBuilder.prefixedSubject(subject, mode: mode) == expected, "\(subject)") }
    }

    @Test func repliesToTheSenderAndQuotesTheOriginal() {
        let d = build(source(), .reply)
        #expect(d.to == [Address(name: "Carla", address: "carla@example.org")] && d.cc.isEmpty && d.subject == "Re: Plan")
        #expect(d.inReplyTo == "m1@example.org" && d.references == ["m0@example.org", "m1@example.org"])
        #expect(d.quotedHtml.contains("On Mon, Oct 5, 2026 at 10:04 PM, Carla &lt;carla@example.org&gt; wrote:"))
        #expect(d.quotedHtml.contains("<blockquote") && d.quotedHtml.contains("<b>text</b>"))
    }

    @Test func prefersReplyTo() {
        let d = build(source(replyTo: [Address(name: "List", address: "list@example.org")]), .reply)
        #expect(d.to.map(\.address) == ["list@example.org"])
    }

    @Test func replyAllDropsOwnAddressesAndAliasesAndDedupes() {
        let cc = [Address(name: "Eve", address: "eve@example.org"), Address(address: "alias@example.com"), Address(name: "Dan again", address: "DAN@example.org")]
        let d = build(source(cc: cc), .replyAll)
        #expect(d.to.map(\.address) == ["carla@example.org", "dan@example.org"])
        #expect(d.cc.map(\.address) == ["eve@example.org"])
    }

    @Test func replyingToYourOwnMailGoesToTheOriginalRecipients() {
        let sent = source(from: [me], to: [Address(name: "Dan", address: "dan@example.org")], cc: [])
        #expect(build(sent, .reply).to.map(\.address) == ["dan@example.org"])
        #expect(build(sent, .replyAll).to.map(\.address) == ["dan@example.org"])
    }

    @Test func fallsBackToTheOriginalRecipientsWhenNothingElseRemains() {
        let selfMail = source(from: [me], to: [me], cc: [])
        #expect(build(selfMail, .reply).to.map(\.address) == ["me@example.com"])
    }

    @Test func forwardBuildsAHeaderBlockAndCarriesAttachmentsOver() {
        let att = [DraftAttachment(id: "1", filename: "a.pdf", contentType: "application/pdf", size: 10, path: "/tmp/a.pdf")]
        let d = build(source(), .forward, attachments: att)
        #expect(d.to.isEmpty && d.cc.isEmpty && d.subject == "Fwd: Plan" && d.attachments == att)
        // Threading headers keep the sent forward in the original conversation, as Gmail and Apple Mail do.
        #expect(d.inReplyTo == "m1@example.org" && d.references == ["m0@example.org", "m1@example.org"])
        #expect(d.quotedHtml.contains("---------- Forwarded message ---------"))
        #expect(d.quotedHtml.contains("From: Carla &lt;carla@example.org&gt;") && d.quotedHtml.contains("Subject: Plan") && d.quotedHtml.contains("Cc: Eve"))
    }

    @Test func plainTextBodiesAreEscaped() {
        let body = ReplyDraftBuilder.plainTextBody("a <script>x</script>\nb")
        #expect(body.contains("&lt;script&gt;") && !body.contains("<script>") && body.contains("white-space:pre-wrap"))
        #expect(ReplyDraftBuilder.plainTextBody(nil) == "<div style=\"white-space:pre-wrap\"></div>")
    }

    @Test func aMessageWithoutIdOrSenderStillQuotes() {
        let bare = ReplySource(from: [], to: [me], subject: "x", date: 0)
        let d = build(bare, .reply)
        #expect(d.inReplyTo == nil && d.references.isEmpty && d.quotedHtml.contains("the sender wrote:"))
        #expect(d.to.map(\.address) == ["me@example.com"]) // only recipient is the user, so the fallback applies
    }
}
