import Foundation
import Testing
import FlintModel
@testable import FlintClassify

@Suite("Classify: verification codes")
struct ClassifyCodeTests {
    @Test func fixtureCases() throws {
        let file = try ClassifyFixtureFile.load("codes")
        let defaults = file.meta["defaults"]?.object ?? [:]
        let detector = CodeDetector()
        var detectCount = 0
        for c in file.cases {
            func field(_ key: String) -> JSONValue? { c.input[key] ?? defaults[key] }
            switch c.input["fn"]?.string {
            case "detectCode":
                detectCount += 1
                let input = DetectInput(
                    subject: field("subject")?.string ?? "", text: field("text")?.string, html: field("html")?.string,
                    fromName: field("fromName")?.string, fromAddress: field("fromAddress")?.string ?? ""
                )
                let got = detector.detect(input)
                if c.expect.isNull {
                    #expect(got == nil, "\(c.name): expected no code, got \(got?.code ?? "")")
                } else {
                    #expect(got?.code == c.expect.object?["code"]?.string, "\(c.name) code")
                    #expect(got?.service == c.expect.object?["service"]?.string, "\(c.name) service")
                }
            case "registrableDomain":
                #expect(CodeDetector.registrableDomain(c.input["host"]?.string ?? "") == c.expect.string, "\(c.name)")
            case "senderDomainOf":
                #expect(CodeDetector.senderDomain(of: c.input["address"]?.string ?? "") == c.expect.string, "\(c.name)")
            case let other:
                Issue.record("unknown fn \(other ?? "nil") in \(c.name)")
            }
        }
        #expect(detectCount >= 40)
    }

    @Test func fullWidthDigitsAreNotACode() {
        let hit = CodeDetector().detect(DetectInput(subject: "Your verification code is １２３４５６", fromAddress: "a@b.com"))
        #expect(hit == nil)
    }

    @Test func injectedHTMLConverterIsUsed() {
        let detector = CodeDetector(htmlToText: { _ in "Your verification code is 552211" })
        #expect(detector.detect(DetectInput(subject: "Hi", html: "<p>ignored</p>", fromAddress: "a@b.com"))?.code == "552211")
    }

    @Test func longBodiesAreSkipped() {
        let body = "Your verification code is 552211. " + String(repeating: "filler ", count: 1000)
        #expect(CodeDetector().detect(DetectInput(subject: "Hi", text: body, fromAddress: "a@b.com")) == nil)
    }

    @Test func simpleHTMLText() {
        let text = SimpleHTMLText.convert("<html><head><style>p{}</style></head><body><!-- c --><p>Code:&nbsp;<b>12&#51;456</b></p><div>x &amp; y</div></body></html>")
        #expect(text == "Code: 123456\n\nx & y")
    }
}
