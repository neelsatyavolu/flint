import FlintModel
import Testing
@testable import FlintStore

@Suite("Store receipt status fixtures")
struct StoreReceiptStatusTests {
    static let cases = StoreFixtures.cases("receipts-status")

    @Test func fixtureIsLoaded() { #expect(Self.cases.count >= 25) }

    @Test(arguments: StoreReceiptStatusTests.cases)
    func matchesSharedFixture(_ c: StoreFixtureCase) throws {
        switch try #require(c.input["fn"]?.fxString) {
        case "recipient":
            let events = (c.input["events"]?.fxArray ?? []).compactMap { e -> ReceiptStatusLogic.Event? in
                guard let o = e.fxObject, let at = o["at"]?.fxInt, let kind = o["kind"]?.fxString.flatMap(ReceiptEventKind.init(rawValue:)) else { return nil }
                return .init(at: at, kind: kind, client: o["client"]?.fxString, fingerprint: o["fingerprint"]?.fxString)
            }
            let d = ReceiptStatusLogic.derive(
                events: events, repliedAt: c.input["repliedAt"]?.fxInt, registered: c.input["registered"]?.fxBool ?? true,
                untrackedReason: c.input["untrackedReason"]?.fxString)
            let got: JSONValue = .object([
                "status": .string(d.status.rawValue), "openCount": .fxNumber(d.openCount), "firstOpenAt": .fxNumber(d.firstOpenAt),
                "lastOpenAt": .fxNumber(d.lastOpenAt), "note": .fxText(d.note), "possiblyForwarded": .bool(d.possiblyForwarded),
            ])
            #expect(got == c.expect)
        case "summarize":
            let recipients = (c.input["recipients"]?.fxArray ?? []).compactMap { r -> (status: ReceiptStatus, lastOpenAt: Int?)? in
                guard let o = r.fxObject, let s = o["status"]?.fxString.flatMap(ReceiptStatus.init(rawValue:)) else { return nil }
                return (s, o["lastOpenAt"]?.fxInt)
            }
            let s = ReceiptStatusLogic.summarize(recipients)
            let got: JSONValue = .object(["opened": .fxNumber(s.opened), "total": .fxNumber(s.total), "status": .string(s.status.rawValue), "lastOpenAt": .fxNumber(s.lastOpenAt)])
            #expect(got == c.expect)
        default: Issue.record("unknown fixture function")
        }
    }
}
