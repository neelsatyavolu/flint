@testable import Flint
import FlintModel
import Foundation
import Testing

private func message(_ id: Int, from: String = "a@x.com", to: [String] = ["me@x.com"], seen: Bool = true, mine: Bool = false) -> MessageView {
    MessageView(
        id: id, accountId: "acc", threadId: 1, from: [Address(address: from)], to: to.map { Address(address: $0) },
        subject: "s", date: id * 1000, seen: seen, isFromMe: mine)
}

@Suite("Thread logic")
struct ThreadLogicTests {
    @Test("reply target is the newest message not from me")
    func target() {
        let list = [message(1), message(2, mine: true)]
        #expect(ThreadLogic.replyTarget(list)?.id == 1)
        #expect(ThreadLogic.replyTarget([message(3, mine: true)])?.id == 3)
        #expect(ThreadLogic.replyTarget([]) == nil)
    }

    @Test("newest and newest unread start expanded")
    func expanded() {
        let list = [message(1, seen: false), message(2, seen: false), message(3), message(4)]
        #expect(ThreadLogic.initialExpanded(list) == [2, 4])
        #expect(ThreadLogic.initialExpanded([]).isEmpty)
    }

    @Test("single recipient decides whether Reply is offered")
    func single() {
        let one = message(1, from: "a@x.com", to: ["me@x.com"])
        #expect(ThreadLogic.hasSingleRecipient(one, selfAddresses: ["ME@x.com"]))
        let many = message(2, from: "a@x.com", to: ["me@x.com", "b@x.com"])
        #expect(!ThreadLogic.hasSingleRecipient(many, selfAddresses: ["me@x.com"]))
    }

    @Test("compose modes map to draft requests")
    func draftInit() {
        #expect(ThreadLogic.draftInit(.reply, messageId: 7) == .reply(messageId: 7))
        #expect(ThreadLogic.draftInit(.replyAll, messageId: 7) == .replyAll(messageId: 7))
        #expect(ThreadLogic.draftInit(.forward, messageId: 7) == .forward(messageId: 7))
    }

    @Test("loaded images win until the stream catches up")
    func merged() {
        var blocked = message(1)
        blocked.remoteImages = .blocked
        var allowed = blocked
        allowed.remoteImages = .allowed
        #expect(ThreadLogic.merged(blocked, override: allowed).remoteImages == .allowed)
        #expect(ThreadLogic.merged(blocked, override: nil).remoteImages == .blocked)
        #expect(ThreadLogic.merged(allowed, override: blocked).remoteImages == .allowed)
    }

    @Test("archive becomes move to inbox outside the inbox")
    func leaves() {
        #expect(!ThreadLogic.leavesInbox(.unifiedInbox))
        #expect(ThreadLogic.leavesInbox(.trash))
        #expect(ThreadLogic.leavesInbox(.folder("a", 1)))
    }
}

@Suite("Quoted text")
struct QuotedTextTests {
    @Test("plain text splits at the attribution line")
    func plain() {
        let text = "Sounds good.\n\nOn Fri, Oct 23, Maya wrote:\n> earlier\n> text"
        let parts = QuotedText.splitPlain(text)
        #expect(parts.body == "Sounds good.")
        #expect(parts.quoted.hasPrefix("On Fri"))
    }

    @Test("a message that is only a quote stays whole")
    func onlyQuote() {
        let parts = QuotedText.splitPlain("> all quoted")
        #expect(parts.quoted.isEmpty)
    }

    @Test("html splits at gmail_quote and keeps head styles")
    func gmail() {
        let html = "<html><head><style>p{color:red}</style></head><body><p>New</p><div class=\"gmail_quote\">old</div></body></html>"
        let parts = QuotedText.splitHTML(html)
        #expect(parts.body.contains("New"))
        #expect(!parts.body.contains("old"))
        #expect(parts.quoted?.contains("old") == true)
        #expect(parts.quoted?.contains("p{color:red}") == true)
    }

    @Test("html splits at an attribution line before a blockquote")
    func attribution() {
        let html = "<div>Thanks</div><div>On Fri, Oct 23, Maya wrote:</div><blockquote>old</blockquote>"
        let parts = QuotedText.splitHTML(html)
        #expect(parts.body == "<div>Thanks</div>")
        #expect(parts.quoted?.contains("blockquote") == true)
    }

    @Test("forwards and forwarded blocks are never hidden")
    func forwarded() {
        let html = "<p>FYI</p><div class=\"gmail_quote\">---------- Forwarded message ---------</div>"
        #expect(QuotedText.splitHTML(html).quoted == nil)
        let quoted = "<p>x</p><blockquote type=\"cite\">y</blockquote>"
        #expect(QuotedText.splitHTML(quoted, subject: "Fwd: x").quoted == nil)
    }

    @Test("nothing above the quote means no split")
    func empty() {
        #expect(QuotedText.splitHTML("<div class=\"gmail_quote\">old</div>").quoted == nil)
    }
}

@Suite("Link policy")
struct LinkPolicyTests {
    @Test("matching text opens directly")
    func matching() {
        #expect(LinkPolicy.decide(href: "https://www.example.com/a", text: "example.com") == .open(URL(string: "https://www.example.com/a")!))
        #expect(LinkPolicy.decide(href: "https://example.com", text: "Read more") == .open(URL(string: "https://example.com")!))
    }

    @Test("text naming another site needs confirmation")
    func mismatch() {
        let decision = LinkPolicy.decide(href: "https://evil.example.net/x", text: "https://bank.com/login")
        #expect(decision == .confirm(URL(string: "https://evil.example.net/x")!, shown: "bank.com"))
    }

    @Test("subdomains count as the same site")
    func subdomain() {
        #expect(LinkPolicy.related("click.example.com", "example.com"))
        #expect(!LinkPolicy.related("example.com", "example.org"))
    }

    @Test("mailto composes and other schemes are ignored")
    func schemes() {
        #expect(LinkPolicy.decide(href: "mailto:a@b.com?subject=Hi", text: "") == .compose(address: "a@b.com"))
        #expect(LinkPolicy.decide(href: "javascript:alert(1)", text: "") == .ignore)
        #expect(LinkPolicy.decide(href: "tel:123", text: "") == .ignore)
        #expect(LinkPolicy.decide(href: "about:blank#x", text: "") == .ignore)
    }
}

@Suite("Mail appearance")
struct MailAppearanceTests {
    @Test("light theme leaves mail alone")
    func light() {
        let a = MailAppearance.resolve(dark: false, matchTheme: true, flipped: false, verdict: nil)
        #expect(a.adapt == .none && !a.lightSheet && !a.canToggle)
    }

    @Test("dark theme with the light setting shows a light sheet")
    func lightSetting() {
        let a = MailAppearance.resolve(dark: true, matchTheme: false, flipped: false, verdict: nil)
        #expect(a.adapt == .none && a.lightSheet && !a.canToggle)
    }

    @Test("dark theme adapts, and the toggle shows the original")
    func adapt() {
        let a = MailAppearance.resolve(dark: true, matchTheme: true, flipped: false, verdict: nil)
        #expect(a.adapt == .auto && !a.showingOriginal && a.canToggle)
        let f = MailAppearance.resolve(dark: true, matchTheme: true, flipped: true, verdict: true)
        #expect(f.adapt == .none && f.lightSheet && f.showingOriginal)
    }

    @Test("mail that cannot be adapted shows the original, and the toggle forces dark")
    func notAdaptable() {
        let a = MailAppearance.resolve(dark: true, matchTheme: true, flipped: false, verdict: false)
        #expect(a.adapt == .auto && a.showingOriginal)
        let f = MailAppearance.resolve(dark: true, matchTheme: true, flipped: true, verdict: false)
        #expect(f.adapt == .force && !f.showingOriginal)
    }
}

@Suite("Reader document and script")
struct ReaderDocumentTests {
    private let palette = ReaderPalette(fg: "#eee", fg3: "#999", accent: "#48f", line: "#333")

    @Test("page carries the adapt mode, sheet and mail html")
    func page() {
        let appearance = MailAppearance.resolve(dark: true, matchTheme: true, flipped: false, verdict: nil)
        let doc = ReaderDocument(html: "<p>Hi</p>", appearance: appearance, palette: palette, attachmentTypes: [:], allowImages: false)
        #expect(doc.page.contains("data-adapt=\"auto\""))
        #expect(doc.page.contains("data-sheet=\"theme\""))
        #expect(doc.page.contains("<body><p>Hi</p></body>"))
        #expect(!doc.page.contains("<script"))
    }

    @Test("the key changes with appearance and images")
    func key() {
        let a = MailAppearance.resolve(dark: true, matchTheme: true, flipped: false, verdict: nil)
        let b = MailAppearance.resolve(dark: true, matchTheme: true, flipped: true, verdict: true)
        let one = ReaderDocument(html: "x", appearance: a, palette: palette, attachmentTypes: [:], allowImages: false)
        #expect(one.key != ReaderDocument(html: "x", appearance: b, palette: palette, attachmentTypes: [:], allowImages: false).key)
        #expect(one.key != ReaderDocument(html: "x", appearance: a, palette: palette, attachmentTypes: [:], allowImages: true).key)
    }

    @Test("script messages parse and reject junk")
    func messages() {
        #expect(ReaderScript.Message(["t": "height", "v": 120]) == .height(120))
        #expect(ReaderScript.Message(["t": "verdict", "adaptable": false]) == .verdict(adaptable: false))
        #expect(ReaderScript.Message(["t": "link", "href": "https://a.com", "text": "a"]) == .link(href: "https://a.com", text: "a"))
        #expect(ReaderScript.Message(["t": "nope"]) == nil)
        #expect(ReaderScript.Message("string") == nil)
    }
}
