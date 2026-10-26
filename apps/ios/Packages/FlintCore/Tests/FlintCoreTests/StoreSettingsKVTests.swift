import FlintModel
import Foundation
import Testing
@testable import FlintStore

@Suite("Store settings")
struct StoreSettingsTests {
    @Test func returnsDefaultsThenMergesStoredOverrides() async throws {
        let store = try StoreTestKit.makeStore()
        #expect(try await store.settings() == .default)
        let next = try await store.updateSettings(.object([
            "appearance": .object(["theme": .string("dark")]),
            "compose": .object(["undoSendSeconds": .number(20), "defaultSignatureByAccount": .object(["a1": .number(3)])]),
        ]))
        var expectedAppearance = Settings.default.appearance
        expectedAppearance.theme = .dark
        #expect(next.appearance == expectedAppearance)
        #expect(next.compose.undoSendSeconds == 20)
        _ = try await store.updateSettings(.object(["compose": .object(["defaultSignatureByAccount": .object(["a2": .null])])]))
        let again = try await store.settings()
        #expect(again.compose.defaultSignatureByAccount.count == 2 && again.compose.defaultSignatureByAccount["a1"] == .some(3))
        #expect(again.appearance.theme == .dark)
        _ = try await store.updateSettings(.object(["ai": .object(["provider": .string("codex"), "model": .string("gpt-x")]), "agents": .object(["send": .string("allow")])]))
        let last = try await store.settings()
        #expect(last.ai.provider == "codex" && last.ai.model == "gpt-x" && last.agents.send == "allow" && last.agents.modify == "allow")
    }

    @Test func rejectsInvalidValuesAndUnknownKeysWithoutChangingAnything() async throws {
        let store = try StoreTestKit.makeStore()
        await expectStoreError(.invalid) { _ = try await store.updateSettings(.object(["appearance": .object(["theme": .string("neon")])])) }
        await expectStoreError(.invalid, "not valid") { _ = try await store.updateSettings(.object(["compose": .object(["undoSendSeconds": .number(7)])])) }
        await expectStoreError(.invalid) { _ = try await store.updateSettings(.object(["nope": .object(["a": .number(1)])])) }
        await expectStoreError(.invalid, "appearance.nope") { _ = try await store.updateSettings(.object(["appearance": .object(["nope": .bool(true)])])) }
        await expectStoreError(.invalid) { _ = try await store.updateSettings(.object(["sync": .object(["initialDays": .number(-1)])])) }
        await expectStoreError(.invalid) { _ = try await store.updateSettings(.string("not an object")) }
        #expect(try await store.settings() == .default)
    }

    @Test func fallsBackToDefaultsWhenStoredDataIsCorrupt() async throws {
        let store = try StoreTestKit.makeStore()
        try await StoreTestKit.exec(store, "INSERT INTO settings (key, value) VALUES ('app', ?)", [#"{"appearance":{"theme":"bogus"}}"#])
        #expect(try await store.settings() == .default)
        try await StoreTestKit.exec(store, "UPDATE settings SET value = 'not json' WHERE key = 'app'")
        #expect(try await store.settings() == .default)
    }
}

@Suite("Store kv cache")
struct StoreKVTests {
    @Test func honorsTTLs() async throws {
        let store = try StoreTestKit.makeStore()
        try await store.kvSet("k", "v", ttlMs: 1000, now: 5000)
        try await store.kvSet("forever", "x", ttlMs: nil, now: 5000)
        #expect(try await store.kvGet("k", now: 5999) == "v")
        #expect(try await store.kvGet("k", now: 6000) == nil)
        #expect(try await store.kvGet("k", now: 5500) == nil) // expired entries are deleted on read
        #expect(try await store.kvGet("forever", now: 9_000_000_000_000) == "x")
        try await store.kvSet("a", "1", ttlMs: 10, now: 0)
        try await store.kvSet("a", "2", ttlMs: 10, now: 100)
        #expect(try await store.kvGet("a", now: 105) == "2")
        #expect(try await store.kvPurgeExpired(now: 1000) == 1)
        try await store.kvDelete("forever")
        #expect(try await store.kvGet("forever", now: 0) == nil)
        #expect(try await store.kvGet("missing", now: 0) == nil)
    }
}

@Suite("Store pending ops")
struct StorePendingOpsTests {
    @Test func recordsBumpsListsAndRemovesOperations() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        let a = try await store.addPendingOp(accountId: s.account.id, PendingOpSpec(kind: .seen, arg: .flag(true)), messageIds: [1, 2], now: 100)
        let b = try await store.addPendingOp(accountId: s.account.id, PendingOpSpec(kind: .moveFolder, arg: .folder(s.archive.id)), messageIds: [3], now: 200)
        let c = try await store.addPendingOp(accountId: s.account.id, PendingOpSpec(kind: .archive), messageIds: [4], now: 300)
        let ops = try await store.listPendingOps()
        #expect(ops.map(\.id) == [a, b, c])
        #expect(ops[0].spec == PendingOpSpec(kind: .seen, arg: .flag(true)) && ops[0].messageIds == [1, 2] && ops[0].createdAt == 100 && ops[0].attempts == 0)
        #expect(ops[1].spec.arg == .folder(s.archive.id))
        #expect(ops[2].spec.arg == nil)
        #expect(try await store.bumpPendingOp(a, error: "timeout") == 1)
        #expect(try await store.bumpPendingOp(a, error: String(repeating: "x", count: 500)) == 2)
        #expect(try await StoreTestKit.count(store, "SELECT LENGTH(last_error) FROM pending_ops WHERE id = ?", [a]) == 300)
        try await store.removePendingOp(a)
        #expect(try await store.listPendingOps().map(\.id) == [b, c])
        let off = try await store.addPendingOp(accountId: s.account.id, PendingOpSpec(kind: .flagged, arg: .flag(false)), messageIds: [], now: 1)
        #expect(try await store.listPendingOps().first { $0.id == off }?.spec.arg == .flag(false))
    }

    @Test func deletingAnAccountDropsItsPendingOps() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        _ = try await store.addPendingOp(accountId: s.account.id, PendingOpSpec(kind: .trash), messageIds: [1], now: 1)
        try await store.deleteAccount(s.account.id)
        #expect(try await store.listPendingOps() == [])
    }
}
