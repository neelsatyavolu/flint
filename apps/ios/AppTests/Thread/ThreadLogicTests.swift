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

@Suite("Thread bar and image notice")
struct ThreadBarLogicTests {
    @Test("Archive or Move to Inbox follows where the conversation is, not the open list")
    func place() {
        // Opened from a search while Archive is selected, but the conversation is in the Inbox.
        #expect(!ThreadLogic.leavesInbox(place: .inbox, selection: .archive))
        #expect(ThreadLogic.leavesInbox(place: .archive, selection: .inbox(nil)))
        #expect(ThreadLogic.leavesInbox(place: .trash, selection: .inbox(nil)))
        #expect(ThreadLogic.leavesInbox(place: .folder, selection: .inbox(nil)))
        #expect(ThreadLogic.leavesInbox(place: .spam, selection: .inbox(nil)))
        #expect(!ThreadLogic.leavesInbox(place: .inbox, selection: .sent))
    }

    @Test("an unknown place falls back to the open list")
    func fallback() {
        #expect(ThreadLogic.leavesInbox(place: nil, selection: .archive))
        #expect(!ThreadLogic.leavesInbox(place: nil, selection: .inbox(nil)))
        #expect(ThreadLogic.inSpam(place: nil, selection: .spam))
        #expect(!ThreadLogic.inSpam(place: nil, selection: .archive))
    }

    @Test("Not spam follows the conversation too")
    func spam() {
        #expect(ThreadLogic.inSpam(place: .spam, selection: .inbox(nil)))
        #expect(!ThreadLogic.inSpam(place: .inbox, selection: .spam))
    }

    @Test("the blocked-images notice needs remote images to load")
    func notice() {
        func view(_ policy: RemoteImagePolicy, remote: Bool) -> MessageView {
            MessageView(id: 1, accountId: "acc", threadId: 1, from: [Address(address: "a@x.com")], subject: "s", date: 1, seen: true,
                        html: "<p>x</p>", remoteImages: policy, hasRemoteImages: remote)
        }
        #expect(ThreadLogic.showsImageNotice(view(.blocked, remote: true)))
        #expect(!ThreadLogic.showsImageNotice(view(.blocked, remote: false)))
        #expect(!ThreadLogic.showsImageNotice(view(.allowed, remote: true)))
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

    @Test("an attribution wrapped in nested tags is cut from its outermost block")
    func nestedAttribution() {
        let html = "<p>Thanks</p><div dir=\"ltr\"><span>On Fri, Oct 23, Maya wrote:</span></div><blockquote type=\"cite\">old</blockquote>"
        let parts = QuotedText.splitHTML(html)
        #expect(parts.body == "<p>Thanks</p>")
        #expect(parts.quoted?.hasPrefix("<div dir") == true)
    }

    @Test("an attribution that follows loose text is not a block start")
    func looseText() {
        let html = "<p>Thanks</p>See below. On Fri, Oct 23, Maya wrote: <blockquote type=\"cite\">old</blockquote>"
        let parts = QuotedText.splitHTML(html)
        #expect(parts.body == "<p>Thanks</p>See below. On Fri, Oct 23, Maya wrote: ")
    }

    @Test("a forwarded attribution is never hidden")
    func forwardedAttribution() {
        let html = "<p>FYI</p><div>On Fri, Oct 23, Maya wrote:</div><div>---------- Forwarded message ---------</div>"
        #expect(QuotedText.splitHTML(html).quoted == nil)
    }

    // MARK: Cost

    /// Image-only promotional markup: long runs of tags with no text between them, the shape that made the old pattern quadratic.
    private static func imageHeavy(bytes: Int) -> String {
        var html = "<html><head><style>img{border:0}</style></head><body>"
        var index = 0
        while html.utf8.count < bytes {
            html += "<div><p><span><a href=\"https://shop.example.com/p/\(index)\"><img src=\"https://cdn.example.com/i/\(index).jpg\" width=\"600\" height=\"200\"></a></span></p></div>\n"
            index += 1
        }
        return html + "</body></html>"
    }

    private func seconds(_ work: () -> Void) -> Double {
        let clock = ContinuousClock()
        let elapsed = clock.measure(work)
        return Double(elapsed.components.seconds) + Double(elapsed.components.attoseconds) / 1e18
    }

    @Test("a 1.3 MB image-heavy mail splits in well under a second")
    func imageHeavyIsFast() {
        let html = Self.imageHeavy(bytes: 1_300_000)
        var plain: QuotedText.HTMLParts?
        let plainTime = seconds { plain = QuotedText.splitHTML(html, subject: "Sale") }
        #expect(plain?.quoted == nil)
        #expect(plainTime < 1.0)

        let replied = html + "<p>Thanks!</p><div>On Fri, Oct 23, Maya wrote:</div><blockquote type=\"cite\">old</blockquote>"
        var split: QuotedText.HTMLParts?
        let splitTime = seconds { split = QuotedText.splitHTML(replied, subject: "Re: Sale") }
        #expect(split?.quoted?.contains("blockquote") == true)
        #expect(split?.body.hasSuffix("<p>Thanks!</p>") == true)
        #expect(splitTime < 1.0)
    }

    @Test("a 1.3 MB mail with an attribution deep in a tag run still splits fast")
    func attributionAfterTagRun() {
        let html = Self.imageHeavy(bytes: 1_300_000) + "<p>Thanks!</p><div><div><div>On Fri, Oct 23, Maya wrote:</div></div></div><div class=\"gmail_quote\">old</div>"
        var split: QuotedText.HTMLParts?
        let time = seconds { split = QuotedText.splitHTML(html) }
        #expect(split?.quoted?.contains("gmail_quote") == true)
        #expect(split?.body.hasSuffix("<p>Thanks!</p>") == true)
        #expect(time < 1.0)
    }

    @Test("plain text with 20,000 blank lines splits fast")
    func blankRuns() {
        let blanks = String(repeating: "\n", count: 20_000)
        let text = "Sounds good." + blanks + "On Fri, Oct 23, Maya wrote:" + blanks + "> earlier"
        var parts: QuotedText.Plain?
        let time = seconds { parts = QuotedText.splitPlain(text) }
        #expect(parts?.body == "Sounds good.")
        #expect(parts?.quoted.hasPrefix("On Fri") == true)
        #expect(time < 1.0)

        let onlyBlanks = "Hello" + blanks + "Bye"
        #expect(seconds { _ = QuotedText.splitPlain(onlyBlanks) } < 1.0)
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
