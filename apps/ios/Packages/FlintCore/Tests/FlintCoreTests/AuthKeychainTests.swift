import FlintMail
import FlintModel
import Foundation
import Security
import Testing

/// Records the SecItem calls the store makes and answers from a dictionary.
final class FakeKeychain: KeychainClient, @unchecked Sendable {
    private let lock = NSLock()
    private var items: [String: Data] = [:]
    private(set) var queries: [[String: Any]] = []
    var failWith: OSStatus?

    private func key(_ q: [String: Any]) -> String { "\(q[kSecAttrService as String] ?? "")|\(q[kSecAttrAccount as String] ?? "")" }

    func add(_ attributes: [String: Any]) -> OSStatus {
        lock.lock(); defer { lock.unlock() }
        queries.append(attributes)
        if let failWith { return failWith }
        if items[key(attributes)] != nil { return errSecDuplicateItem }
        items[key(attributes)] = attributes[kSecValueData as String] as? Data
        return errSecSuccess
    }

    func update(_ query: [String: Any], with attributes: [String: Any]) -> OSStatus {
        lock.lock(); defer { lock.unlock() }
        queries.append(query)
        if let failWith { return failWith }
        guard items[key(query)] != nil else { return errSecItemNotFound }
        items[key(query)] = attributes[kSecValueData as String] as? Data
        return errSecSuccess
    }

    func copyData(_ query: [String: Any]) -> (status: OSStatus, data: Data?) {
        lock.lock(); defer { lock.unlock() }
        queries.append(query)
        if let failWith { return (failWith, nil) }
        guard let data = items[key(query)] else { return (errSecItemNotFound, nil) }
        return (errSecSuccess, data)
    }

    func delete(_ query: [String: Any]) -> OSStatus {
        lock.lock(); defer { lock.unlock() }
        queries.append(query)
        if let failWith { return failWith }
        return items.removeValue(forKey: key(query)) == nil ? errSecItemNotFound : errSecSuccess
    }
}

@Suite("Auth Keychain secret store")
struct AuthKeychainTests {
    @Test func roundTripsAndOverwrites() async throws {
        let store = KeychainSecretStore(client: FakeKeychain())
        #expect(try await store.get("account:a1") == nil)
        try await store.set("account:a1", value: #"{"password":"x"}"#)
        #expect(try await store.get("account:a1") == #"{"password":"x"}"#)
        try await store.set("account:a1", value: #"{"password":"y"}"#)
        #expect(try await store.get("account:a1") == #"{"password":"y"}"#)
    }

    @Test func deleteIsIdempotent() async throws {
        let store = KeychainSecretStore(client: FakeKeychain())
        try await store.set("k", value: "v")
        try await store.delete("k")
        try await store.delete("k")
        #expect(try await store.get("k") == nil)
    }

    @Test func itemsUseTheDocumentedClassAndProtection() async throws {
        let fake = FakeKeychain()
        let store = KeychainSecretStore(client: fake)
        try await store.set("account:a1", value: "v")
        _ = try await store.get("account:a1")
        for q in fake.queries {
            #expect(q[kSecClass as String] as? String == kSecClassGenericPassword as String)
            #expect(q[kSecAttrService as String] as? String == "co.xanom.flint.account")
            #expect(q[kSecAttrAccount as String] as? String == "account:a1")
            #expect(q[kSecAttrSynchronizable as String] as? Bool == false)
        }
        let added = try #require(fake.queries.first)
        #expect(added[kSecAttrAccessible as String] as? String == kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String)
    }

    @Test func serviceNameIsConfigurable() async throws {
        let fake = FakeKeychain()
        try await KeychainSecretStore(service: "test.service", client: fake).set("k", value: "v")
        #expect(fake.queries.first?[kSecAttrService as String] as? String == "test.service")
    }

    @Test func keychainFailuresAreInternalErrorsWithoutValues() async {
        let fake = FakeKeychain()
        fake.failWith = errSecInteractionNotAllowed
        let store = KeychainSecretStore(client: fake)
        for op in [{ try await store.set("k", value: "TOPSECRET") }, { _ = try await store.get("k") }, { try await store.delete("k") }] as [() async throws -> Void] {
            do { try await op(); Issue.record("should throw") }
            catch let e as FlintError {
                #expect(e.code == .internal)
                #expect(!e.message.contains("TOPSECRET"))
                #expect(e.message.contains("\(errSecInteractionNotAllowed)"))
            } catch { Issue.record("wrong error") }
        }
    }

    @Test func nonUTF8DataReadsAsInternalError() async {
        let fake = FakeKeychain()
        _ = fake.add([kSecAttrService as String: "co.xanom.flint.account", kSecAttrAccount as String: "k", kSecValueData as String: Data([0xFF, 0xFE])])
        do { _ = try await KeychainSecretStore(client: fake).get("k"); Issue.record("should throw") }
        catch let e as FlintError { #expect(e.code == .internal) } catch { Issue.record("wrong error") }
    }

    /// Opt in with FLINT_KEYCHAIN=1: touches the real login keychain on the Mac host (it may show an access prompt).
    @Test(.enabled(if: ProcessInfo.processInfo.environment["FLINT_KEYCHAIN"] == "1"))
    func realKeychainRoundTrip() async throws {
        let store = KeychainSecretStore(service: "co.xanom.flint.test.\(UUID().uuidString)")
        try await store.set("k", value: "v1")
        try await store.set("k", value: "v2")
        #expect(try await store.get("k") == "v2")
        try await store.delete("k")
        #expect(try await store.get("k") == nil)
    }
}
