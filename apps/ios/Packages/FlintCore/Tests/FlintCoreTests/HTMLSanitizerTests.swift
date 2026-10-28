import FlintHTML
import FlintModel
import Foundation
import Testing

private let receiptsHost = "receipts.flint.example"
private let sanitizeFixture = loadFixtureFile("sanitize")

private func options(from json: FX) -> SanitizeOptions {
    let cids = json["cids"]?.fxStringMap ?? [:]
    let resolver: (@Sendable (String) -> String?)? = cids.isEmpty ? nil : { @Sendable (cid: String) -> String? in cids[cid] }
    return SanitizeOptions(
        allowRemoteImages: json["allowRemoteImages"]?.fxBool ?? false,
        receiptsHost: json["receiptsHost"]?.fxString ?? receiptsHost,
        cidResolver: resolver,
        blockTrackers: json["blockTrackers"]?.fxBool ?? true
    )
}

private func buildHTML(_ input: FX) -> String {
    if let html = input["html"]?.fxString { return html }
    let r = input["htmlRepeat"]!
    return (r["before"]?.fxString ?? "") + String(repeating: r["unit"]?.fxString ?? "", count: r["count"]?.fxInt ?? 0) + (r["after"]?.fxString ?? "")
}

private func token(_ s: String) -> String { s.replacingOccurrences(of: "{{PLACEHOLDER_GIF}}", with: placeholderGIF) }

/// Output must never contain anything a browser would execute or fetch behind the user's back.
private func assertInert(_ html: String, sourceLocation: SourceLocation = #_sourceLocation) {
    let lower = html.lowercased()
    for check in sanitizeFixture.meta["inert"]?.fxArray ?? [] {
        var text = lower
        if check["applyTo"]?.fxString == "lowerValuesBlanked" {
            text = lower.replacingOccurrences(of: #"="[^"]*"|='[^']*'"#, with: "=\"\"", options: .regularExpression)
        }
        let re = fixtureRegex(check["regex"]?.fxString ?? "", flags: check["flags"]?.fxString ?? "")
        #expect(!regexMatches(re, text), "\(check["name"]?.fxString ?? "inert check")", sourceLocation: sourceLocation)
    }
}

@Suite("HTML sanitizer fixtures")
struct HTMLSanitizerFixtureTests {
    @Test func placeholderIsPinned() {
        #expect(sanitizeFixture.meta["placeholderGif"]?.fxString == placeholderGIF)
    }

    @Test(arguments: sanitizeFixture.cases(fn: "sanitize"))
    func sanitizeCase(_ c: FixtureCase) {
        let html = buildHTML(c.input)
        let runs = c.input["runs"]?.fxArray ?? [c.input["options"] ?? FX(.null)]
        let want = c.expect
        for run in runs {
            let opts = options(from: run)
            let started = Date()
            let result = HTMLSanitizer.sanitize(html, opts)
            if let maxMs = want["maxMs"]?.fxInt { #expect(Date().timeIntervalSince(started) * 1000 < Double(maxMs), "took too long") }
            if want["inert"]?.fxBool == true { assertInert(result.html) }
            for s in want["contains"]?.fxStrings ?? [] { #expect(result.html.contains(token(s)), "missing \(s)") }
            for s in want["notContains"]?.fxStrings ?? [] { #expect(!result.html.contains(token(s)), "unexpected \(s)") }
            for m in want["matches"]?.fxArray ?? [] {
                #expect(regexMatches(fixtureRegex(m["p"]?.fxString ?? "", flags: m["f"]?.fxString ?? ""), result.html))
            }
            for m in want["notMatches"]?.fxArray ?? [] {
                #expect(!regexMatches(fixtureRegex(m["p"]?.fxString ?? "", flags: m["f"]?.fxString ?? ""), result.html))
            }
            if let v = want["hasRemoteImages"]?.fxBool { #expect(result.hasRemoteImages == v) }
            if let v = want["hasTrackers"]?.fxBool { #expect(result.hasTrackers == v) }
            if let prefix = want["startsWith"]?.fxString { #expect(result.html.hasPrefix(prefix)) }
            if want["idempotent"]?.fxBool == true { #expect(HTMLSanitizer.sanitize(result.html, opts).html == result.html) }
        }
    }
}

@Suite("HTML sanitizer behavior")
struct HTMLSanitizerBehaviorTests {
    private func clean(_ html: String, images: Bool = false) -> SanitizeResult {
        HTMLSanitizer.sanitize(html, SanitizeOptions(allowRemoteImages: images, receiptsHost: receiptsHost))
    }

    @Test func countsTrackersForTheLabel() {
        let html = #"<img src="https://mailtrack.io/a.png" width="1" height="1"><img src="https://pixel.mailtrack.io/b.gif"><p>x</p>"#
        let result = clean(html, images: true)
        #expect(result.trackerCount == 2 && result.hasTrackers)
    }

    @Test func emptyAndTextOnlyInput() {
        #expect(clean("").html == "")
        #expect(clean("plain <b>text</b> & more").html == "plain <b>text</b> &amp; more")
    }

    @Test func attributeValuesCannotCarryMarkup() {
        let html = #"<p title="</p><script>alert(1)</script>">x</p>"#
        let out = clean(html).html
        #expect(!out.contains("<script"))
        #expect(out.contains("&lt;/p&gt;"))
    }

    @Test func formElementsKeepTheirTextButNotTheirTags() {
        let out = clean(#"<form action="https://evil"><input name="p"><button>Go</button></form>"#).html
        #expect(out == "Go")
    }

    @Test func flintDropMarkerFromMailIsIgnored() {
        let out = clean(#"<div data-flint-drop="1">kept</div>"#).html
        #expect(out == "<div>kept</div>")
    }

    @Test func deeplyNestedMarkupDoesNotCrash() {
        let depth = 3000
        let html = String(repeating: "<div>", count: depth) + "deep" + String(repeating: "</div>", count: depth)
        let out = clean(html).html
        #expect(out.contains("deep"))
    }

    @Test func linkWithoutHrefLosesTargetAndRel() {
        let out = clean(##"<a target="_blank" rel="x">t</a><a href="#top" target="_blank">h</a>"##).html
        #expect(out == "<a>t</a><a href=\"#top\">h</a>")
    }
}
