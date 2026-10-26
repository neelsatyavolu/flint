// Keychain-backed `SecretStore` (track 2C). Generic passwords under service `co.xanom.flint.account`, readable after the
// first unlock, never synced and never moved to another device. Values are secrets: they never appear in errors or logs.

import FlintModel
import Foundation
import Security

/// The four SecItem calls the store needs. Tests substitute a fake; `SystemKeychain` is the real one.
public protocol KeychainClient: Sendable {
    func add(_ attributes: [String: Any]) -> OSStatus
    func update(_ query: [String: Any], with attributes: [String: Any]) -> OSStatus
    func copyData(_ query: [String: Any]) -> (status: OSStatus, data: Data?)
    func delete(_ query: [String: Any]) -> OSStatus
}

public struct SystemKeychain: KeychainClient {
    public init() {}

    public func add(_ attributes: [String: Any]) -> OSStatus { SecItemAdd(attributes as CFDictionary, nil) }

    public func update(_ query: [String: Any], with attributes: [String: Any]) -> OSStatus {
        SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    }

    public func copyData(_ query: [String: Any]) -> (status: OSStatus, data: Data?) {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        return (status, result as? Data)
    }

    public func delete(_ query: [String: Any]) -> OSStatus { SecItemDelete(query as CFDictionary) }
}

public struct KeychainSecretStore: SecretStore {
    public static let defaultService = "co.xanom.flint.account"

    private let service: String
    private let client: any KeychainClient

    public init(service: String = KeychainSecretStore.defaultService, client: any KeychainClient = SystemKeychain()) {
        self.service = service
        self.client = client
    }

    private func query(_ key: String) -> [String: Any] {
        var q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecAttrSynchronizable as String: false,
        ]
        #if os(iOS) || os(visionOS)
        q[kSecUseDataProtectionKeychain as String] = true
        #endif
        return q
    }

    private func failure(_ status: OSStatus, _ what: String) -> FlintError {
        FlintError(.internal, "Keychain \(what) failed (status \(status)).")
    }

    public func get(_ key: String) async throws -> String? {
        let (status, data) = client.copyData(query(key))
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw failure(status, "read") }
        guard let data, let value = String(data: data, encoding: .utf8) else { throw failure(errSecDecode, "read") }
        return value
    }

    public func set(_ key: String, value: String) async throws {
        let data = Data(value.utf8)
        var attributes = query(key)
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let added = client.add(attributes)
        if added == errSecSuccess { return }
        guard added == errSecDuplicateItem else { throw failure(added, "write") }
        let updated = client.update(
            query(key), with: [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly])
        guard updated == errSecSuccess else { throw failure(updated, "write") }
    }

    public func delete(_ key: String) async throws {
        let status = client.delete(query(key))
        guard status == errSecSuccess || status == errSecItemNotFound else { throw failure(status, "delete") }
    }
}
