import FlintModel
import FlintReceipts
import Foundation
import Testing

private let pixelFixture = loadFixtureFile("receipts-pixel")
private let statusFixture = loadFixtureFile("receipts-status")

@Suite("Receipts pixel fixtures")
struct ReceiptsPixelFixtureTests {
    @Test func tokenPatternIsPinned() {
        #expect(pixelFixture.meta["tokenRegex"]?.fxString == "^[A-Za-z0-9_-]{22}$")
    }

    @Test func tokensAre22Base64URLCharactersAndDiffer() {
        let a = ReceiptPixel.newToken()
        #expect(ReceiptPixel.isTokenShape(a))
        #expect(ReceiptPixel.newToken() != a)
        #expect(Set((0..<200).map { _ in ReceiptPixel.newToken() }).count == 200)
    }

    @Test func pixelMarkupMatchesSpec() {
        #expect(ReceiptPixel.pixelTag("https://r.example/i/abc.gif")
            == #"<img src="https://r.example/i/abc.gif" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0" />"#)
    }

    @Test(arguments: pixelFixture.cases)
    func pixelCase(_ c: FixtureCase) {
        let i = c.input
        switch i["fn"]?.fxString {
        case "canonicalAddress": #expect(ReceiptPixel.canonicalAddress(i["address"]?.fxString ?? "") == c.expect.fxString)
        case "pixelTag": #expect(ReceiptPixel.pixelTag(i["url"]?.fxString ?? "") == c.expect.fxString)
        case "injectPixel": #expect(ReceiptPixel.injectPixel(into: i["html"]?.fxString ?? "", pixelURL: i["pixelUrl"]?.fxString ?? "") == c.expect.fxString)
        case "normalizeEndpoint": #expect(ReceiptPixel.normalizeEndpoint(i["endpoint"]?.fxString ?? "") == c.expect.fxString)
        case "pixelUrlFor": #expect(ReceiptPixel.pixelURL(endpoint: i["endpoint"]?.fxString ?? "", token: i["token"]?.fxString ?? "") == c.expect.fxString)
        case "tokenShape": #expect(ReceiptPixel.isTokenShape(i["token"]?.fxString ?? "") == c.expect.fxBool)
        default: Issue.record("unknown fn in \(c.name)")
        }
    }

    @Test func endpointRejectsCredentialsAndUnsafeSchemes() {
        #expect(ReceiptPixel.normalizeEndpoint("https://user:pw@r.example") == nil)
        #expect(ReceiptPixel.normalizeEndpoint("http://[::1]:8787/") == "http://[::1]:8787")
        #expect(ReceiptPixel.normalizeEndpoint("https://r.example:443/x/") == "https://r.example/x")
        #expect(ReceiptPixel.normalizeEndpoint("javascript:alert(1)") == nil)
    }
}

@Suite("Receipts status fixtures")
struct ReceiptsStatusFixtureTests {
    @Test func forwardGapIsPinned() {
        #expect(statusFixture.meta["forwardGapMs"]?.fxInt == ReceiptStatusRules.forwardGapMs)
    }

    @Test(arguments: statusFixture.cases)
    func statusCase(_ c: FixtureCase) {
        let i = c.input
        if i["fn"]?.fxString == "summarize" {
            let snapshots = (i["recipients"]?.fxArray ?? []).map {
                ReceiptStatusRules.RecipientSnapshot(status: ReceiptStatus(rawValue: $0["status"]?.fxString ?? "") ?? .sent, lastOpenAt: $0["lastOpenAt"]?.fxInt)
            }
            let summary = ReceiptStatusRules.summarize(snapshots)
            #expect(summary.opened == c.expect["opened"]?.fxInt)
            #expect(summary.total == c.expect["total"]?.fxInt)
            #expect(summary.status.rawValue == c.expect["status"]?.fxString)
            #expect(summary.lastOpenAt == c.expect["lastOpenAt"]?.fxInt)
            return
        }
        // Mirrors the store's recompute: only kind "open" counts; any "prefetch" marks the recipient unknowable.
        let events = i["events"]?.fxArray ?? []
        let counted = events.filter { $0["kind"]?.fxString == "open" }
            .map { ReceiptStatusRules.CountedOpen(at: $0["at"]?.fxInt ?? 0, fingerprint: $0["fingerprint"]?.fxString, client: $0["client"]?.fxString) }
            .sorted { $0.at < $1.at }
        let registered = i["registered"]?.fxBool ?? true
        let status = ReceiptStatusRules.recipientStatus(.init(
            openCount: counted.count, repliedAt: i["repliedAt"]?.fxInt,
            sawPrefetch: events.contains { $0["kind"]?.fxString == "prefetch" }, registered: registered
        ))
        #expect(status.rawValue == c.expect["status"]?.fxString)
        #expect(counted.count == c.expect["openCount"]?.fxInt)
        #expect(counted.first?.at == c.expect["firstOpenAt"]?.fxInt)
        #expect(counted.last?.at == c.expect["lastOpenAt"]?.fxInt)
        #expect(ReceiptStatusRules.recipientNote(status, registered: registered, untrackedReason: i["untrackedReason"]?.fxString) == c.expect["note"]?.fxString)
        #expect(ReceiptStatusRules.isPossiblyForwarded(counted) == c.expect["possiblyForwarded"]?.fxBool)
    }
}
