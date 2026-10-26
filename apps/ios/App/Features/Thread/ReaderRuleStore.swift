import FlintHTML
import Foundation
import WebKit

/// Compiles and caches the `WKContentRuleList`s every message web view carries (see `ContentRuleLists`): remote loads
/// blocked (images allowed after "Load images"), known trackers (unless the person turned Block trackers off), and the user's own
/// receipts host. A block in any list wins, so trackers stay blocked after "Load images". The reader never loads a message
/// unless every list compiled.
@MainActor
final class ReaderRuleStore {
    static let shared = ReaderRuleStore()

    private struct Wanted {
        let base: String
        let json: String
        var id: String { ReaderRuleIdentifier.stable(base: base, json: json) }
    }

    private struct Compiled: @unchecked Sendable { let list: WKContentRuleList? }

    private var cache: [String: WKContentRuleList] = [:]
    private var inFlight: [String: Task<Compiled, Never>] = [:]
    private var cleaned: Set<String> = []

    /// The lists for one message, or nil when one failed to compile (the caller then shows plain text instead).
    func lists(allowImages: Bool, blockTrackers: Bool = true, receiptsEndpoint: String?) async -> [WKContentRuleList]? {
        var out: [WKContentRuleList] = []
        for item in wanted(allowImages: allowImages, blockTrackers: blockTrackers, receiptsEndpoint: receiptsEndpoint) {
            guard let list = await list(item) else { return nil }
            out.append(list)
        }
        return out
    }

    private func wanted(allowImages: Bool, blockTrackers: Bool, receiptsEndpoint: String?) -> [Wanted] {
        let remoteBase = allowImages ? ContentRuleLists.remoteLoadsWithImagesIdentifier : ContentRuleLists.remoteLoadsIdentifier
        var items = [Wanted(base: remoteBase, json: ContentRuleLists.remoteLoads(allowImages: allowImages))]
        if blockTrackers { items.append(Wanted(base: ContentRuleLists.trackersIdentifier, json: ContentRuleLists.trackers())) }
        if let endpoint = receiptsEndpoint, !endpoint.isEmpty, let json = ContentRuleLists.receipts(host: endpoint) {
            items.append(Wanted(base: ContentRuleLists.receiptsIdentifier, json: json))
        }
        return items
    }

    private func list(_ item: Wanted) async -> WKContentRuleList? {
        let id = item.id
        if let cached = cache[id] { return cached }
        let task = inFlight[id] ?? Task { Compiled(list: await Self.lookUpOrCompile(id: id, json: item.json)) }
        inFlight[id] = task
        let list = await task.value.list
        inFlight[id] = nil
        guard let list else { return nil }
        cache[id] = list
        await removeStale(base: item.base, keeping: id)
        return list
    }

    /// The stored copy when there is one, else a fresh compile (which the store keeps for the next launch).
    private static func lookUpOrCompile(id: String, json: String) async -> WKContentRuleList? {
        guard let store = WKContentRuleListStore.default() else { return nil }
        if let stored = try? await store.contentRuleList(forIdentifier: id) { return stored }
        return try? await store.compileContentRuleList(forIdentifier: id, encodedContentRuleList: json)
    }

    /// Removes lists left by earlier launches or rules: the bare legacy names, other digests, and receipts hosts no longer in use.
    private func removeStale(base: String, keeping id: String) async {
        guard cleaned.insert(base).inserted, let store = WKContentRuleListStore.default(),
              let stored = await store.availableIdentifiers() else { return }
        for old in stored where ReaderRuleIdentifier.isStale(old, base: base, keeping: id) {
            try? await store.removeContentRuleList(forIdentifier: old)
        }
    }
}
