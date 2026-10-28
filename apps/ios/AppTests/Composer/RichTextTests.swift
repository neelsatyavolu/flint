@testable import Flint
import Foundation
import SwiftUI
import Testing

@Suite("Composer: rich text")
struct RichTextTests {
    private func styled(_ text: String, intent: InlinePresentationIntent = [], link: URL? = nil) -> AttributedString {
        var piece = AttributedString(text)
        if !intent.isEmpty { piece.inlinePresentationIntent = intent }
        piece.link = link
        return piece
    }

    @Test("bold, italic and links become tags, text is escaped")
    func inline() throws {
        var text = styled("Hi ")
        text.append(styled("Ann & Bo", intent: .stronglyEmphasized))
        text.append(styled(" <now>", intent: [.emphasized, .stronglyEmphasized]))
        text.append(styled(" site", link: try #require(URL(string: "https://example.com/a?b=1&c=2"))))
        #expect(RichTextHTML.html(from: text)
            == "<div>Hi <b>Ann &amp; Bo</b><b><i> &lt;now&gt;</i></b><a href=\"https://example.com/a?b=1&amp;c=2\"> site</a></div>")
    }

    @Test("lines become divs, empty lines keep their space, bullets become one list")
    func blocks() {
        let text = AttributedString("One\n\n• a\n• b\nTwo")
        #expect(RichTextHTML.html(from: text) == "<div>One</div><div><br></div><ul><li>a</li><li>b</li></ul><div>Two</div>")
        #expect(RichTextHTML.html(from: AttributedString("  \n ")) == "")
        #expect(RichTextHTML.isEmpty(AttributedString("\n  ")))
    }

    @Test("plain text keeps lines and bullets, and shows a link's address")
    func plain() throws {
        var text = AttributedString("See ")
        text.append(styled("the doc", link: try #require(URL(string: "https://example.com"))))
        text.append(AttributedString("\n• item"))
        #expect(RichTextHTML.plainText(from: text) == "See the doc (https://example.com)\n• item")
    }

    @Test("HTML from a draft comes back as the same text and styles")
    func roundTrip() throws {
        let html = "<div>Hi <b>Ann</b> and <i>Bo</i></div><div><br></div><div>Go <a href=\"https://example.com/?a=1&amp;b=2\">here</a></div><ul><li>one</li><li>two</li></ul>"
        let text = RichTextHTML.attributed(fromHTML: html)
        #expect(String(text.characters) == "Hi Ann and Bo\n\nGo here\n• one\n• two")
        #expect(RichTextHTML.html(from: text) == html)
        let link = text.runs.compactMap(\.link).first
        #expect(link?.absoluteString == "https://example.com/?a=1&b=2")
    }

    @Test("foreign HTML: tags dropped, whitespace collapsed, entities decoded, style skipped")
    func foreign() {
        let html = "<style>p{color:red}</style><p>Hello&nbsp;&amp; <span>welcome</span></p>\n<p>It&#39;s  fine &#x41;</p>"
        #expect(String(RichTextHTML.attributed(fromHTML: html).characters) == "Hello & welcome\nIt's fine A")
        #expect(String(RichTextHTML.attributed(fromHTML: "").characters) == "")
    }

    @Test("a br inside a div ends its line without adding a blank one")
    func trailingBreak() {
        #expect(String(RichTextHTML.attributed(fromHTML: "<div>a<br></div><div>b</div>").characters) == "a\nb")
        #expect(String(RichTextHTML.attributed(fromHTML: "a<br><br>b").characters) == "a\n\nb")
    }
}

@Suite("Composer: formatting")
struct RichTextFormattingTests {
    @Test("bold on a selection sets the intent and a second toggle clears it")
    func bold() {
        var text = AttributedString("hello world")
        let range = text.index(text.startIndex, offsetByCharacters: 6)..<text.endIndex
        var selection = AttributedTextSelection(range: range)
        #expect(!RichTextFormatting.isActive(.bold, in: text, selection: selection))
        RichTextFormatting.toggle(.bold, text: &text, selection: &selection)
        #expect(RichTextHTML.html(from: text) == "<div>hello <b>world</b></div>")
        #expect(RichTextFormatting.isActive(.bold, in: text, selection: selection))
        RichTextFormatting.toggle(.bold, text: &text, selection: &selection)
        #expect(RichTextHTML.html(from: text) == "<div>hello world</div>")
    }

    @Test("italic and bold stack")
    func stack() {
        var text = AttributedString("abc")
        var selection = AttributedTextSelection(range: text.startIndex..<text.endIndex)
        RichTextFormatting.toggle(.italic, text: &text, selection: &selection)
        RichTextFormatting.toggle(.bold, text: &text, selection: &selection)
        #expect(RichTextHTML.html(from: text) == "<div><b><i>abc</i></b></div>")
    }

    @Test("a link on a selection, then removed")
    func link() throws {
        var text = AttributedString("see docs")
        let range = text.index(text.startIndex, offsetByCharacters: 4)..<text.endIndex
        var selection = AttributedTextSelection(range: range)
        let url = try #require(URL(string: "https://example.com"))
        RichTextFormatting.setLink(url, text: &text, selection: &selection)
        #expect(RichTextHTML.html(from: text) == "<div>see <a href=\"https://example.com\">docs</a></div>")
        #expect(RichTextFormatting.link(in: text, selection: selection) == url)
        RichTextFormatting.setLink(nil, text: &text, selection: &selection)
        #expect(RichTextHTML.html(from: text) == "<div>see docs</div>")
    }

    @Test("bullets on the lines a selection touches, and off again")
    func bullets() {
        var text = AttributedString("one\ntwo\nthree")
        let from = text.index(text.startIndex, offsetByCharacters: 5)
        let to = text.index(text.startIndex, offsetByCharacters: 9)
        var selection = AttributedTextSelection(range: from..<to)
        RichTextFormatting.toggleBullets(text: &text, selection: &selection)
        #expect(String(text.characters) == "one\n• two\n• three")
        RichTextFormatting.toggleBullets(text: &text, selection: &selection)
        #expect(String(text.characters) == "one\ntwo\nthree")
    }

    @Test("a caret on an empty body starts a bullet")
    func emptyBullet() {
        var text = AttributedString("")
        var selection = AttributedTextSelection(insertionPoint: text.startIndex)
        RichTextFormatting.toggleBullets(text: &text, selection: &selection)
        #expect(String(text.characters) == "• ")
    }

    @Test("typed addresses become links, with https added")
    func urls() {
        #expect(ComposerFormatBar.url(from: "example.com")?.absoluteString == "https://example.com")
        #expect(ComposerFormatBar.url(from: "http://a.b/c")?.absoluteString == "http://a.b/c")
        #expect(ComposerFormatBar.url(from: "mailto:a@b.co")?.absoluteString == "mailto:a@b.co")
        #expect(ComposerFormatBar.url(from: "two words") == nil)
        #expect(ComposerFormatBar.url(from: " ") == nil)
    }
}
