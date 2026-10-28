import FlintHTML
import FlintModel
import Foundation
import Testing

private let sanitizeFixture = loadFixtureFile("sanitize")

@Suite("HTML text fixtures")
struct HTMLTextFixtureTests {
    @Test(arguments: sanitizeFixture.cases(fn: "htmlToText"))
    func htmlToTextCase(_ c: FixtureCase) {
        let wrap = c.input["wordwrap"]?.fxInt
        let text = HTMLText.htmlToText(c.input["html"]?.fxString ?? "", wordwrap: wrap)
        let want = c.expect
        if let equals = want["equals"]?.fxString { #expect(text == equals) }
        for s in want["contains"]?.fxStrings ?? [] { #expect(text.contains(s)) }
        for s in want["notContains"]?.fxStrings ?? [] { #expect(!text.contains(s)) }
        if want["noTripleNewline"]?.fxBool == true { #expect(!text.contains("\n\n\n")) }
        if let max = want["maxLineLength"]?.fxInt {
            #expect(text.split(separator: "\n", omittingEmptySubsequences: false).map(\.count).max() ?? 0 <= max)
        }
    }

    @Test(arguments: sanitizeFixture.cases(fn: "snippetFrom"))
    func snippetCase(_ c: FixtureCase) {
        let text = c.input["text"]?.fxString ?? ""
        let snippet = c.input["max"]?.fxInt.map { HTMLText.snippet(from: text, max: $0) } ?? HTMLText.snippet(from: text)
        #expect(snippet == c.expect["equals"]?.fxString)
    }

    @Test func orderedListsAndMailtoLinks() {
        let text = HTMLText.htmlToText(#"<ol><li>a</li><li>b</li></ol><a href="mailto:x@y.z">Mail</a>"#)
        #expect(text.contains("1. a") && text.contains("2. b") && text.contains("Mail (x@y.z)"))
    }

    @Test func tablesKeepOneRowPerLine() {
        let text = HTMLText.htmlToText("<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>")
        #expect(text == "A  B\nC  D")
    }
}

@Suite("CSS cleaner fixtures")
struct CSSCleanerFixtureTests {
    @Test(arguments: sanitizeFixture.cases(fn: "decodeCssEscapes"))
    func decodeCase(_ c: FixtureCase) {
        #expect(CSSCleaner.decodeEscapes(c.input["css"]?.fxString ?? "") == c.expect.fxString)
    }

    @Test(arguments: sanitizeFixture.cases(fn: "cleanCss"))
    func cleanCase(_ c: FixtureCase) {
        let result = CSSCleaner.clean(c.input["css"]?.fxString ?? "", allowRemote: c.input["allowRemote"]?.fxBool ?? false)
        #expect(result.css == c.expect["css"]?.fxString)
        #expect(result.remoteUrls == c.expect["remoteUrls"]?.fxStrings)
    }

    @Test func oversizedInputIsDropped() {
        let big = String(repeating: "a", count: CSSCleaner.maxLength + 1)
        #expect(CSSCleaner.clean(big, allowRemote: true) == CSSResult(css: "", remoteUrls: []))
    }

    @Test func dataUrisAndLocalUrlsAreNotRemote() {
        let result = CSSCleaner.clean("background:url(data:image/png;base64,AAAA);list-style:url(local.png)", allowRemote: false)
        #expect(result.remoteUrls.isEmpty)
    }

    @Test func webkitImageSetIsReplacedWholeWhenRemote() {
        let result = CSSCleaner.clean("background:-webkit-image-set(url(https://a/x.png) 1x, url(https://a/y.png) 2x);color:red", allowRemote: false)
        #expect(result.css == "background:none;color:red")
        #expect(result.remoteUrls.count == 1)
    }

    @Test func caseInsensitiveUrlAndImportBlocked() {
        let result = CSSCleaner.clean("@IMPORT 'x.css'; BACKGROUND:URL(HTTPS://A/B.PNG)", allowRemote: false)
        #expect(!result.css.lowercased().contains("import"))
        #expect(!result.css.contains("A/B.PNG"))
    }
}
