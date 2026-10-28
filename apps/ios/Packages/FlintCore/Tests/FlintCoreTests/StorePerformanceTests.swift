import FlintModel
import Foundation
import Testing
@testable import FlintStore

/// Wave 2 acceptance: a 20k-message synthetic mailbox answers the first list query in under 50 ms and an FTS query in under 100 ms.
@Suite("Store performance", .serialized)
struct StorePerformanceTests {
    private static let threads = 5_000
    private static let perThread = 4

    private func elapsedMs(_ body: () async throws -> Void) async throws -> Double {
        let start = ContinuousClock.now
        try await body()
        let d = ContinuousClock.now - start
        return Double(d.components.seconds) * 1000 + Double(d.components.attoseconds) / 1e15
    }

    @Test func serves20kMessagesInFirstListUnder50msAndSearchUnder100ms() async throws {
        let path = FileManager.default.temporaryDirectory.appendingPathComponent("flint-perf-\(UUID().uuidString)/flint.sqlite").path
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
        let store = try GRDBStore.open(path: path, classifier: StoreTestClassifier())
        let s = try await StoreTestKit.seedImap(store)
        _ = try await store.blockSender("blocked@spam.example")
        var batch: [IngestMessage] = []
        for t in 0..<Self.threads {
            let root = "root\(t)@perf"
            for k in 0..<Self.perThread {
                let uid = t * Self.perThread + k + 1
                batch.append(StoreTestKit.msg(uid) {
                    $0.messageId = k == 0 ? root : "m\(uid)@perf"
                    $0.references = k == 0 ? [] : [root]
                    $0.inReplyTo = k == 0 ? nil : root
                    $0.subject = "Thread \(t)"
                    $0.from = [StoreTestKit.person("Sender\(t % 300)", "s\(t % 300)@perf.example")]
                    $0.date = StoreTestKit.t0 + t * 60_000 + k * 1000
                    $0.flags = MessageFlags(seen: uid % 3 == 0)
                    $0.snippet = "snippet \(uid)"
                    $0.headers = t % 10 == 0 ? ["list-id": "<news.perf>"] : [:]
                })
            }
        }
        let ingestMs = try await elapsedMs {
            for i in stride(from: 0, to: batch.count, by: 1000) {
                _ = try await store.ingestMessages(s.account.id, s.inbox.id, Array(batch[i..<min(i + 1000, batch.count)]), context: IngestContext(evaluate: false))
            }
        }
        #expect(try await StoreTestKit.count(store, "SELECT COUNT(*) FROM messages") == Self.threads * Self.perThread)
        #expect(try await StoreTestKit.count(store, "SELECT COUNT(*) FROM threads") == Self.threads)

        let now = StoreTestKit.t0 + 30 * StoreTestKit.day
        var count = 0
        var cursor: String?
        try await store.writer.write { try $0.execute(sql: "PRAGMA optimize") }
        let first = try await elapsedMs { let p = try await store.listThreads(ThreadQuery(view: .inbox, limit: 50), now: now); count = p.items.count; cursor = p.nextCursor }
        #expect(count == 50)
        let after = try #require(cursor)
        let next = try await elapsedMs { count = try await store.listThreads(ThreadQuery(view: .inbox, cursor: after, limit: 50), now: now).items.count }
        #expect(count == 50)
        let focused = try await elapsedMs { count = try await store.listThreads(ThreadQuery(view: .inbox, focused: true, limit: 50), now: now).bundles.count }
        #expect(count == 1)
        let unread = try await elapsedMs { _ = try await store.listThreads(ThreadQuery(view: .inbox, unreadOnly: true, limit: 50), now: now) }
        let search = try await elapsedMs { count = try await store.listThreads(ThreadQuery(view: .search, search: "thread 42", limit: 50), now: now).items.count }
        #expect(count > 0)
        let sidebar = try await elapsedMs { _ = try await store.sidebarData(now: now) }
        print("store perf ms: ingest20k=\(Int(ingestMs)) first=\(first) next=\(next) focused=\(focused) unread=\(unread) search=\(search) sidebar=\(sidebar)")
        #expect(first < 50, "first inbox page took \(first) ms")
        #expect(next < 50, "next inbox page took \(next) ms")
        #expect(search < 100, "search took \(search) ms")
    }
}
