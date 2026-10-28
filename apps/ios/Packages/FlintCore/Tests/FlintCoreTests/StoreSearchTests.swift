import FlintModel
import Foundation
import Testing
@testable import FlintStore

@Suite("Store search fixtures")
struct StoreSearchTests {
    static let cases = StoreFixtures.cases("search")

    @Test func fixtureIsLoaded() { #expect(Self.cases.count >= 80) }

    private func query(_ c: StoreFixtureCase) -> String {
        if let q = c.input["query"]?.fxString { return q }
        if let r = c.input["repeat"]?.fxObject {
            return String(repeating: r["unit"]?.fxString ?? "", count: r["count"]?.fxInt ?? 0)
        }
        return ""
    }

    private func filters(_ list: [SearchFilter]) -> JSONValue {
        .array(list.map { .object(["value": .string($0.value), "negated": .bool($0.negated)]) })
    }

    private func json(_ p: ParsedSearch) -> JSONValue {
        .object([
            "terms": .array(p.terms.map { .object(["text": .string($0.text), "phrase": .bool($0.phrase), "negated": .bool($0.negated)]) }),
            "from": filters(p.from), "to": filters(p.to), "cc": filters(p.cc), "subject": filters(p.subject),
            "in": filters(p.in), "account": filters(p.account),
            "hasAttachment": .fxFlag(p.hasAttachment), "unread": .fxFlag(p.unread), "pinned": .fxFlag(p.pinned), "snoozed": .fxFlag(p.snoozed),
            "before": .fxText(StoreFixtures.dayString(p.before)), "after": .fxText(StoreFixtures.dayString(p.after)),
        ])
    }

    @Test(arguments: StoreSearchTests.cases.filter { ["parseSearch", "parseDay", "buildMatch", "isEmptySearch", "escapeLike", "searchWhere"].contains($0.input["fn"]?.fxString ?? "") })
    func localSearchMatchesSharedFixture(_ c: StoreFixtureCase) throws {
        let fn = try #require(c.input["fn"]?.fxString)
        switch fn {
        case "parseSearch": #expect(json(SearchParser.parse(query(c), calendar: StoreFixtures.calendar)) == c.expect)
        case "parseDay": #expect(StoreFixtures.dayString(SearchParser.parseDay(c.input["value"]?.fxString ?? "", calendar: StoreFixtures.calendar)) == c.expect.fxString)
        case "buildMatch":
            let terms = SearchParser.parse(query(c), calendar: StoreFixtures.calendar).terms
            #expect(SearchSQL.buildMatch(terms, prefixLast: c.input["prefixLast"]?.fxBool ?? false) == c.expect.fxString)
        case "isEmptySearch": #expect(SearchSQL.isEmpty(SearchParser.parse(query(c), calendar: StoreFixtures.calendar)) == c.expect.fxBool)
        case "escapeLike": #expect(SQL.escapeLike(c.input["value"]?.fxString ?? "") == c.expect.fxString)
        case "searchWhere":
            let w = SearchSQL.buildWhere(SearchParser.parse(query(c), calendar: StoreFixtures.calendar), now: c.input["now"]?.fxInt ?? 0)
            let params: [JSONValue] = w.params.map { p in
                switch p {
                case .text(let s): .string(s)
                case .int(let n): .fxNumber(n)
                }
            }
            let got: JSONValue = .object(["sql": .string(w.sql), "params": .array(params), "excludeTrashSpam": .bool(w.excludeTrashSpam)])
            #expect(got == c.expect)
        default: Issue.record("unknown fixture function \(fn)")
        }
    }

    @Test(arguments: StoreSearchTests.cases.filter { ["buildGmailRaw", "buildImapCriteria", "inTargets"].contains($0.input["fn"]?.fxString ?? "") })
    func serverSearchMatchesSharedFixture(_ c: StoreFixtureCase) throws {
        let parsed = SearchParser.parse(query(c), calendar: StoreFixtures.calendar)
        switch try #require(c.input["fn"]?.fxString) {
        case "buildGmailRaw": #expect(SearchServer.gmailRaw(parsed, calendar: StoreFixtures.calendar) == c.expect.fxString)
        case "buildImapCriteria":
            let got = SearchServer.imapCriteria(parsed)
            let value: JSONValue = got.map { crit in
                var o: [String: JSONValue] = [:]
                if let v = crit.from { o["from"] = .string(v) }
                if let v = crit.to { o["to"] = .string(v) }
                if let v = crit.cc { o["cc"] = .string(v) }
                if let v = crit.subject { o["subject"] = .string(v) }
                if let v = crit.text { o["text"] = .string(v) }
                if let v = crit.seen { o["seen"] = .bool(v) }
                if let v = crit.flagged { o["flagged"] = .bool(v) }
                if let v = crit.since { o["since"] = .string(StoreFixtures.dayString(v) ?? "") }
                if let v = crit.before { o["before"] = .string(StoreFixtures.dayString(v) ?? "") }
                return .object(o)
            } ?? .null
            #expect(value == c.expect)
        case "inTargets":
            let t = SearchServer.inTargets(parsed)
            #expect(JSONValue.object(["roles": .array(t.roles.map { .string($0) }), "names": .array(t.names.map { .string($0) })]) == c.expect)
        default: Issue.record("unknown fixture function")
        }
    }

    @Test func parseNeverFailsOnOddInput() {
        #expect(SearchParser.parse("\u{0}\"unterminated from:").terms.count >= 1)
        #expect(SearchParser.parse(String(repeating: "word ", count: 500)).terms.count == 40)
    }
}
