import FlintModel
import Testing
@testable import FlintStore

@Suite("Store threading fixtures")
struct StoreThreadingTests {
    static let cases = StoreFixtures.cases("threadkey")

    @Test func fixtureIsLoaded() { #expect(Self.cases.count >= 50) }

    @Test(arguments: StoreThreadingTests.cases)
    func matchesSharedFixture(_ c: StoreFixtureCase) throws {
        let i = c.input
        let fn = try #require(i["fn"]?.fxString)
        let threading = ThreadingInput(
            gmThrid: i["gmThrid"]?.fxString, messageId: i["messageId"]?.fxString, inReplyTo: i["inReplyTo"]?.fxString,
            references: (i["references"]?.fxArray ?? []).compactMap(\.fxString))
        switch fn {
        case "normalizeSubject": #expect(Threading.normalizeSubject(i["subject"]?.fxString ?? "") == c.expect.fxString)
        case "joinSubject": #expect(Threading.joinSubject(i["subject"]?.fxString ?? "") == c.expect.fxString)
        case "isGenericSubject": #expect(Threading.isGenericSubject(i["subject"]?.fxString ?? "") == c.expect.fxBool)
        case "cleanMessageId": #expect(cleanID(i["value"]?.fxString) == c.expect.fxString)
        case "sharesParticipant":
            let a = Set((i["a"]?.fxArray ?? []).compactMap(\.fxString).map { $0.lowercased() })
            let b = Set((i["b"]?.fxArray ?? []).compactMap(\.fxString).map { $0.lowercased() })
            #expect(Threading.sharesParticipant(a, b) == c.expect.fxBool)
        case "isAutomatedHeaders":
            let headers = (i["headers"]?.fxObject ?? [:]).compactMapValues(\.fxString)
            #expect(Threading.isAutomatedHeaders(headers) == c.expect.fxBool)
        case "threadKeyFor": #expect(Threading.threadKey(for: threading) == c.expect.fxString)
        case "hasParentLink": #expect(Threading.hasParentLink(threading) == c.expect.fxBool)
        case "linkedIds": #expect(Threading.linkedIDs(threading) == (c.expect.fxArray ?? []).compactMap(\.fxString))
        default: Issue.record("unknown fixture function \(fn)")
        }
    }
}
