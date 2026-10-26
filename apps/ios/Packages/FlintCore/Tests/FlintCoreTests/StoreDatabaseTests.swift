import FlintModel
import Foundation
import GRDB
import Testing
@testable import FlintStore

@Suite("Store database file")
struct StoreDatabaseTests {
    private func tempPath() -> String {
        FileManager.default.temporaryDirectory.appendingPathComponent("flint-store-\(UUID().uuidString)/flint.sqlite").path
    }

    @Test func gRDBStoreIsAStore() throws {
        let store: any Store = try StoreTestKit.makeStore()
        #expect(store is GRDBStore)
    }

    @Test func persistsAcrossReopenAndMigratesOnlyOnce() async throws {
        let path = tempPath()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
        let accountId: String
        do {
            let store = try GRDBStore.open(path: path, classifier: StoreTestClassifier())
            let s = try await StoreTestKit.seedImap(store)
            accountId = s.account.id
            _ = try await store.ingestMessages(s.account.id, s.inbox.id, [StoreTestKit.msg(1) { $0.subject = "kept"; $0.textBody = "persistent words" }], context: IngestContext())
        }
        let reopened = try GRDBStore.open(path: path, classifier: StoreTestClassifier())
        #expect(try await reopened.account(id: accountId) != nil)
        let inbox = try #require(try await reopened.folder(accountId: accountId, role: .inbox))
        #expect(try await reopened.listLocalUids(inbox.id, minUid: 0) == [1])
        #expect(try await reopened.listThreads(ThreadQuery(view: .search, search: "persistent"), now: StoreTestKit.t0).items.count == 1)
        #expect(try await StoreTestKit.count(reopened, "SELECT COUNT(*) FROM grdb_migrations") == 8)
    }

    @Test func createsTheFolderAndFilePrivateToTheUser() throws {
        let path = tempPath()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
        _ = try GRDBStore.open(path: path)
        let file = try FileManager.default.attributesOfItem(atPath: path)[.posixPermissions] as? Int
        let dir = try FileManager.default.attributesOfItem(atPath: (path as NSString).deletingLastPathComponent)[.posixPermissions] as? Int
        #expect(file == 0o600 && dir == 0o700)
    }

    @Test func usesWALAndEnforcesForeignKeys() async throws {
        let path = tempPath()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
        let store = try GRDBStore.open(path: path)
        #expect(try await store.writer.read { try String.fetchOne($0, sql: "PRAGMA journal_mode") } == "wal")
        #expect(try await StoreTestKit.count(store, "PRAGMA foreign_keys") == 1)
        await expectStoreError(.internal) { try await store.write { try $0.execute(sql: "INSERT INTO folders (account_id, path, name) VALUES ('missing', 'x', 'x')") } }
    }

    @Test func errorsNeverCarryMessageContent() async throws {
        let store = try StoreTestKit.makeStore()
        let secret = "SECRET-BODY-TEXT"
        do {
            try await store.write { db in
                try db.execute(sql: "INSERT INTO folders (account_id, path, name) VALUES (?, 'x', 'x')", arguments: ["missing-\(secret)"])
            }
            Issue.record("expected a constraint failure")
        } catch let e as FlintError {
            #expect(e.code == .internal)
            #expect(!e.message.contains(secret) && !e.message.contains("INSERT"))
        }
    }

    @Test func readersAndWritersRunConcurrently() async throws {
        let path = tempPath()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
        let store = try GRDBStore.open(path: path, classifier: StoreTestClassifier())
        let s = try await StoreTestKit.seedImap(store)
        try await withThrowingTaskGroup(of: Void.self) { group in
            for batch in 0..<8 {
                group.addTask {
                    let items = (0..<25).map { i in StoreTestKit.msg(batch * 25 + i + 1) { $0.subject = "b\(batch) m\(i)"; $0.from = [StoreTestKit.person("P\(batch)\(i)")] } }
                    _ = try await store.ingestMessages(s.account.id, s.inbox.id, items, context: IngestContext())
                }
                group.addTask {
                    for _ in 0..<10 { _ = try await store.listThreads(ThreadQuery(view: .inbox), now: StoreTestKit.t0 + StoreTestKit.day) }
                }
            }
            try await group.waitForAll()
        }
        #expect(try await store.listLocalUids(s.inbox.id, minUid: 0).count == 200)
        #expect(try await StoreTestKit.count(store, "SELECT COUNT(*) FROM messages_fts") == 200)
    }
}

@Suite("Store default classifier")
struct StoreDefaultClassifierTests {
    @Test func withoutAClassifierEverythingIsPeopleAndNoRuleFires() async throws {
        let store = try GRDBStore.inMemory()
        let s = try await StoreTestKit.seedImap(store)
        _ = try await store.saveRule(StoreTestKit.rule("any", conditions: [RuleCondition(field: .subject, op: .contains, value: "x")], actions: [.mute]))
        let o = try await store.ingestMessages(s.account.id, s.inbox.id, [StoreTestKit.msg(1) {
            $0.subject = "x"; $0.from = [StoreTestKit.person("Bot", "noreply@ci.com")]; $0.headers = ["list-id": "<a>"]
        }], context: IngestContext())[0]
        #expect(o.category == .people && o.ruleActions == [])
        #expect(GRDBStore.systemClock() > 1_700_000_000_000)
    }

    @Test func theInjectedClockStampsRulesAndBlockedSenders() async throws {
        let store = try GRDBStore.inMemory(clock: { 4242 })
        _ = try await store.blockSender("x@y.com")
        #expect(try await store.listBlocked().first?.createdAt == 4242)
        let account = try await store.createAccount(StoreTestKit.newAccount("c@d.com"))
        #expect(account.createdAt == 4242)
    }
}
