@testable import Flint
import FlintHTML
import Foundation
import Testing
import WebKit

@Suite("Reader rule list names")
struct ReaderRuleIdentifierTests {
    @Test("a name is stable for the same rules and changes with them")
    func stable() {
        let base = ContentRuleLists.receiptsIdentifier
        let a = ReaderRuleIdentifier.stable(base: base, json: "[1]")
        #expect(a == ReaderRuleIdentifier.stable(base: base, json: "[1]"))
        #expect(a != ReaderRuleIdentifier.stable(base: base, json: "[2]"))
        #expect(a.hasPrefix(base + "."))
        #expect(a.count == base.count + 1 + 12)
    }

    @Test("only older copies of the same list are stale")
    func stale() {
        let base = ContentRuleLists.remoteLoadsIdentifier
        let current = ReaderRuleIdentifier.stable(base: base, json: "[]")
        #expect(!ReaderRuleIdentifier.isStale(current, base: base, keeping: current))
        #expect(ReaderRuleIdentifier.isStale(base, base: base, keeping: current))
        #expect(ReaderRuleIdentifier.isStale(base + ".abc", base: base, keeping: current))
        // "remote-images" is another list, not an older copy of "remote".
        #expect(!ReaderRuleIdentifier.isStale(ContentRuleLists.remoteLoadsWithImagesIdentifier, base: base, keeping: current))
        #expect(!ReaderRuleIdentifier.isStale("unrelated", base: base, keeping: current))
    }
}

@MainActor
@Suite("Reader rule store", .serialized)
struct ReaderRuleStoreTests {
    private let endpoint = "https://receipts-test.example.org"

    private func storedReaderIdentifiers() async -> [String] {
        let all = await WKContentRuleListStore.default()?.availableIdentifiers() ?? []
        return all.filter { $0.hasPrefix("co.xanom.flint.reader") }.sorted()
    }

    @Test("Block trackers off leaves the tracker list out")
    func trackersOff() async throws {
        let store = ReaderRuleStore()
        let on = try #require(await store.lists(allowImages: true, blockTrackers: true, receiptsEndpoint: nil))
        let off = try #require(await store.lists(allowImages: true, blockTrackers: false, receiptsEndpoint: nil))
        #expect(on.count == 2)
        #expect(off.count == 1)
        #expect(!off.contains { $0.identifier.hasPrefix(ContentRuleLists.trackersIdentifier) })
        #expect(on.contains { $0.identifier.hasPrefix(ContentRuleLists.trackersIdentifier) })
    }

    @Test("a second launch finds the stored lists instead of adding more, and old copies are removed")
    func stableAcrossLaunches() async throws {
        let first = ReaderRuleStore()
        let a = try #require(await first.lists(allowImages: false, blockTrackers: true, receiptsEndpoint: endpoint))
        let afterFirst = await storedReaderIdentifiers()
        #expect(afterFirst.contains(a[0].identifier))

        // Leftovers from an earlier build: the bare name and a random per-launch receipts name.
        let store = try #require(WKContentRuleListStore.default())
        let rules = #"[{"trigger":{"url-filter":"stale"},"action":{"type":"block"}}]"#
        _ = try await store.compileContentRuleList(forIdentifier: "co.xanom.flint.reader.receipts.987654321", encodedContentRuleList: rules)
        _ = try await store.compileContentRuleList(forIdentifier: ContentRuleLists.trackersIdentifier, encodedContentRuleList: rules)

        let second = ReaderRuleStore()
        let b = try #require(await second.lists(allowImages: false, blockTrackers: true, receiptsEndpoint: endpoint))
        #expect(a.map(\.identifier) == b.map(\.identifier))
        let afterSecond = await storedReaderIdentifiers()
        #expect(afterSecond == afterFirst)
        #expect(!afterSecond.contains("co.xanom.flint.reader.receipts.987654321"))
        #expect(!afterSecond.contains(ContentRuleLists.trackersIdentifier))
    }
}
