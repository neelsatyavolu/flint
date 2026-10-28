@testable import FlintHTML
import FlintModel
import Foundation
import Testing

private let trackerFixture = loadFixtureFile("trackers")

@Suite("Tracker fixtures")
struct TrackerFixtureTests {
    @Test func rulesTableMatchesSyncedFixture() {
        let fixtureRules = trackerFixture.root["rules"]?.fxArray ?? []
        let swiftRules = TrackerRules.all
        #expect(fixtureRules.count == swiftRules.count)
        for (fixture, rule) in zip(fixtureRules, swiftRules) {
            #expect(fixture["host"]?.fxString == rule.host)
            #expect(fixture["path"]?["source"]?.fxString == rule.pathPattern)
            if fixture["path"] != nil { #expect(fixture["path"]?["flags"]?.fxString == "i") }
        }
    }

    @Test(arguments: trackerFixture.cases)
    func trackerCase(_ c: FixtureCase) {
        let url = c.input["url"]?.fxString ?? ""
        switch c.input["fn"]?.fxString {
        case "hostOf": #expect(TrackerRules.hostOf(url) == c.expect.fxString)
        case "matchesTrackerRule": #expect(TrackerRules.matches(url) == c.expect.fxBool)
        case "looksLikePixelUrl": #expect(TrackerRules.looksLikePixel(url) == c.expect.fxBool)
        case "isReceiptsUrl": #expect(TrackerRules.isReceiptsURL(url, receiptsHost: c.input["receiptsHost"]?.fxString) == c.expect.fxBool)
        default: Issue.record("unknown fn in \(c.name)")
        }
    }
}

@Suite("Reader content rule lists")
struct ContentRuleListTests {
    private func rules(_ json: String) throws -> [[String: Any]] {
        let object = try JSONSerialization.jsonObject(with: Data(json.utf8))
        return try #require(object as? [[String: Any]])
    }

    private func filters(_ json: String) throws -> [String] {
        try rules(json).compactMap { ($0["trigger"] as? [String: Any])?["url-filter"] as? String }
    }

    @Test func remoteLoadsBlockEverythingHTTPButNotInlineSchemes() throws {
        let list = try rules(ContentRuleLists.remoteLoads(allowImages: false))
        let first = try #require(list.first?["trigger"] as? [String: Any])
        #expect(first["url-filter"] as? String == "^https?://")
        let types = try #require(first["resource-type"] as? [String])
        #expect(types.contains("image") && types.contains("style-sheet") && types.contains("font") && types.contains("script"))
        #expect(!types.contains("document"))
        for rule in list { #expect((rule["action"] as? [String: String])?["type"] == "block") }
        // data:, cid: and flint-attachment: never match these filters.
        for f in try filters(ContentRuleLists.remoteLoads(allowImages: false)) { #expect(f.hasPrefix("^")) }
    }

    @Test func loadImagesLeavesImagesButKeepsEverythingElseBlocked() throws {
        let list = try rules(ContentRuleLists.remoteLoads(allowImages: true))
        let first = try #require(list.first?["trigger"] as? [String: Any])
        let types = try #require(first["resource-type"] as? [String])
        #expect(!types.contains("image"))
        #expect(types.contains("style-sheet") && types.contains("font") && types.contains("media") && types.contains("fetch"))
    }

    @Test func trackerListHasNoAlternationAndIsBounded() throws {
        let all = try filters(ContentRuleLists.trackers())
        #expect(all.count > TrackerRules.all.count)
        #expect(all.count < 5000)
        for f in all {
            #expect(!f.contains("|"), "alternation is not supported in url-filter: \(f)")
            #expect(!f.contains("(") && !f.contains(")"), "groups are not needed: \(f)")
            #expect(f.hasPrefix("^https?://"))
        }
    }

    @Test func everyPathPatternExpands() {
        let withPath = TrackerRules.all.filter { $0.pathPattern != nil }
        for rule in withPath {
            let escaped = rule.host.replacingOccurrences(of: ".", with: "\\.")
            let pathFilters = ContentRuleLists.trackerFilters().filter { $0.contains(escaped + ".*") || $0.contains("\\." + escaped + ".*") }
            #expect(pathFilters.count >= 2, "\(rule.host) should have path filters for the host and its subdomains")
        }
    }

    @Test func trackerFiltersCoverHostAndSubdomains() throws {
        let all = try filters(ContentRuleLists.trackers())
        #expect(all.contains("^https?://mailtrack\\.io[:/?#]"))
        #expect(all.contains("^https?://[a-z0-9.-]*\\.mailtrack\\.io[:/?#]"))
        #expect(all.contains("^https?://list-manage\\.com.*/track/open"))
    }

    @Test func pathExpansionHandlesGroupsOptionalsAndBoundaries() throws {
        let simple = try #require(ContentRuleLists.expandPathPattern(#"\/(open|track)"#))
        #expect(Set(simple) == ["/open", "/track"])
        let optional = try #require(ContentRuleLists.expandPathPattern(#"\/(e\/)?(open|track)"#))
        #expect(Set(optional) == ["/open", "/track", "/e/open", "/e/track"])
        let topLevel = try #require(ContentRuleLists.expandPathPattern(#"\/q\/|\/o\/"#))
        #expect(Set(topLevel) == ["/q/", "/o/"])
        let boundary = try #require(ContentRuleLists.expandPathPattern(#"\/(o|open)\b"#))
        #expect(boundary.contains("/o/") && boundary.contains("/open?") && boundary.contains("/o$"))
        #expect(!boundary.contains("/o"))
        let dots = try #require(ContentRuleLists.expandPathPattern(#"\/(on|o)\.jsp"#))
        #expect(Set(dots) == ["/on\\.jsp", "/o\\.jsp"])
    }

    @Test func unsupportedPatternsAreRejectedNotGuessed() {
        #expect(ContentRuleLists.expandPathPattern("/a.*b") == nil)
        #expect(ContentRuleLists.expandPathPattern("/(a|b") == nil)
        #expect(ContentRuleLists.expandPathPattern("/[ab]") == nil)
    }

    @Test func receiptsListBlocksHostAndSubdomains() throws {
        let json = try #require(ContentRuleLists.receipts(host: "https://receipts.flint.example/base"))
        let all = try filters(json)
        #expect(all == ["^https?://receipts\\.flint\\.example[:/?#]", "^https?://[a-z0-9.-]*\\.receipts\\.flint\\.example[:/?#]"])
        #expect(ContentRuleLists.receipts(host: "") == nil)
    }
}
