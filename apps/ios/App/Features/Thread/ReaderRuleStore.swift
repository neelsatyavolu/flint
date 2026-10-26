import FlintHTML
import Foundation
import WebKit

/// Compiles and caches the `WKContentRuleList`s every message web view carries (see `ContentRuleLists`): remote loads
/// blocked (images allowed after "Load images"), known trackers, and the user's own receipts host. A block in any list wins,
/// so trackers stay blocked after "Load images". The reader never loads a message unless every list compiled.
@MainActor
final class ReaderRuleStore {
    static let shared = ReaderRuleStore()

    private var cache: [String: WKContentRuleList] = [:]

    /// The lists for one message, or nil when one failed to compile (the caller then shows plain text instead).
    func lists(allowImages: Bool, receiptsEndpoint: String?) async -> [WKContentRuleList]? {
        var wanted: [(id: String, json: String)] = [
            (allowImages ? ContentRuleLists.remoteLoadsWithImagesIdentifier : ContentRuleLists.remoteLoadsIdentifier, ContentRuleLists.remoteLoads(allowImages: allowImages)),
            (ContentRuleLists.trackersIdentifier, ContentRuleLists.trackers()),
        ]
        if let endpoint = receiptsEndpoint, !endpoint.isEmpty, let json = ContentRuleLists.receipts(host: endpoint) {
            wanted.append(("\(ContentRuleLists.receiptsIdentifier).\(abs(endpoint.hashValue))", json))
        }
        var out: [WKContentRuleList] = []
        for item in wanted {
            guard let list = await list(id: item.id, json: item.json) else { return nil }
            out.append(list)
        }
        return out
    }

    private func list(id: String, json: String) async -> WKContentRuleList? {
        if let cached = cache[id] { return cached }
        guard let store = WKContentRuleListStore.default() else { return nil }
        let compiled = try? await store.compileContentRuleList(forIdentifier: id, encodedContentRuleList: json)
        if let compiled { cache[id] = compiled }
        return compiled
    }
}
