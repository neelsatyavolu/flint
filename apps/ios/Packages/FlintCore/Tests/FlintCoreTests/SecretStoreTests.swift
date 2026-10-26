import Foundation
import Testing
@testable import FlintModel

@Suite("SecretStore")
struct SecretStoreTests {
    @Test func storesAndDeletes() async throws {
        let store = InMemorySecretStore()
        #expect(try await store.get("k") == nil)
        try await store.set("k", value: "v")
        #expect(try await store.get("k") == "v")
        try await store.delete("k")
        #expect(try await store.get("k") == nil)
    }

    @Test func accountSecretRoundTripUsesDesktopKey() async throws {
        let store = InMemorySecretStore()
        try await store.writeAccountSecret("a1", .oauth(accessToken: "t", refreshToken: "r", expiresAt: 7))
        #expect(try await store.get("account:a1") != nil)
        #expect(try await store.readAccountSecret("a1") == .oauth(accessToken: "t", refreshToken: "r", expiresAt: 7))
    }

    @Test func missingSecretIsAuthError() async {
        let store = InMemorySecretStore()
        await #expect(throws: FlintError.self) { try await store.readAccountSecret("nope") }
        do { _ = try await store.readAccountSecret("nope") } catch let error as FlintError { #expect(error.code == .auth) } catch { Issue.record("wrong error") }
    }

    @Test func unreadableSecretIsAuthError() async {
        let store = InMemorySecretStore(["account:a1": "{not json"])
        do { _ = try await store.readAccountSecret("a1"); Issue.record("should throw") }
        catch let error as FlintError { #expect(error.code == .auth) }
        catch { Issue.record("wrong error") }
    }
}
