// FROZEN CONTRACT (Wave 1, track 1B). Swift analogue of `SecretStore` in packages/core/src/platform.ts.
// The Keychain implementation lives in FlintMail/Auth (track 2C). Never log values.

import Foundation

public protocol SecretStore: Sendable {
    func get(_ key: String) async throws -> String?
    func set(_ key: String, value: String) async throws
    func delete(_ key: String) async throws
}

/// Key under which an account's `AccountSecret` JSON is stored (same as desktop).
public func secretKey(for accountId: AccountID) -> String { "account:\(accountId)" }

/// In-memory secrets for tests and previews.
public actor InMemorySecretStore: SecretStore {
    private var values: [String: String]

    public init(_ initial: [String: String] = [:]) {
        values = initial
    }

    public func get(_ key: String) async throws -> String? { values[key] }
    public func set(_ key: String, value: String) async throws { values[key] = value }
    public func delete(_ key: String) async throws { values[key] = nil }
}

extension SecretStore {
    /// Reads and decodes an account's secret. Throws `.auth` when it is missing or unreadable.
    public func readAccountSecret(_ accountId: AccountID) async throws -> AccountSecret {
        guard let raw = try await get(secretKey(for: accountId)) else {
            throw FlintError(.auth, "No saved sign-in for this account. Sign in again.")
        }
        do {
            return try JSONDecoder().decode(AccountSecret.self, from: Data(raw.utf8))
        } catch {
            throw FlintError(.auth, "The saved sign-in for this account is unreadable. Sign in again.")
        }
    }

    public func writeAccountSecret(_ accountId: AccountID, _ secret: AccountSecret) async throws {
        let data = try JSONEncoder().encode(secret)
        try await set(secretKey(for: accountId), value: String(decoding: data, as: UTF8.self))
    }
}
