@testable import Flint
import FlintModel
import Foundation
import Testing

@Suite("First page prefetch", .serialized)
@MainActor
struct FirstPagePrefetchTests {
    private let inboxQuery = ThreadQuery(view: .inbox, focused: true, limit: InboxViewModel.pageSize)

    @Test("a prefetched page is handed out once, and only for the query it was read for")
    func handedOutOnceForTheSameQuery() async {
        let model = AppModel(mode: .live)
        let page = ThreadPage(items: [], nextCursor: "next")
        model.prefetch = Task { FirstPagePrefetch(query: inboxQuery, page: page) }
        #expect(await model.takePrefetchedPage(for: inboxQuery) == page)
        #expect(await model.takePrefetchedPage(for: inboxQuery) == nil)

        model.prefetch = Task { FirstPagePrefetch(query: inboxQuery, page: page) }
        var other = inboxQuery
        other.unreadOnly = true
        #expect(await model.takePrefetchedPage(for: other) == nil)
        #expect(model.prefetch == nil, "a page for another list is dropped, not kept for later")
    }

    @Test("a failed read leaves nothing to take")
    func failedReadIsNil() async {
        let model = AppModel(mode: .live)
        model.prefetch = Task { nil }
        #expect(await model.takePrefetchedPage(for: inboxQuery) == nil)
    }

    @Test("opening the app reads the inbox page the list will ask for, and it equals a normal read")
    func openingPrefetchesTheInbox() async throws {
        let model = AppModel(mode: .demo)
        await model.bootstrap()
        defer { Task { await model.shutdown() } }
        let query = try #require(model.threadQuery(for: model.mailbox, limit: InboxViewModel.pageSize))
        let prefetched = try #require(await model.takePrefetchedPage(for: query))
        #expect(!prefetched.items.isEmpty)
        let normal = try await model.listThreads(query)
        #expect(prefetched.items.map(\.id) == normal.items.map(\.id))
        #expect(await model.takePrefetchedPage(for: query) == nil)
    }

    @Test("an injected service is not prefetched, so tests that count service calls see no extra read")
    func injectedModeSkipsThePrefetch() async throws {
        let model = AppModel(mode: .injected(try await DemoSeed.make().service))
        await model.bootstrap()
        #expect(model.prefetch == nil)
        await model.shutdown()
    }
}
