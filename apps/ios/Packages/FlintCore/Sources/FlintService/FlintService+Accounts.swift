// Accounts, settings, read receipts and verification codes.

import FlintMail
import FlintModel
import FlintReceipts
import FlintStore
import Foundation

extension FlintService {
    // MARK: Accounts

    public func listAccounts() async throws -> [Account] { try await core.store.listAccounts() }

    /// Server settings for an address, from the preset table, the provider's published settings or DNS. Nil when nothing is known.
    public func autoconfig(email: String) async throws -> AutoconfigResult? { try await core.auth.accountService().autoconfig(email) }

    /// What the add-account screen shows for a provider: the settings, plus advice such as "needs Proton Bridge".
    public func autoconfigAdvice(email: String) async -> ProviderAdvice? {
        try? await FlintMail.autoconfig(email: email, deps: core.config.autoconfig).iosAdvice
    }

    /// IMAP sign-in, then SMTP verify, reported separately. Nothing is saved.
    public func testConnection(_ input: AddAccountInput) async throws -> ConnectionCheck {
        try await core.auth.accountService().testConnection(input)
    }

    /// Whether the stored password logs in to `server`. Nothing is saved.
    public func storedPasswordWorks(id: AccountID, on server: ServerConfig) async throws -> Bool {
        try await core.auth.accountService().storedPasswordWorks(id, on: server)
    }

    public func addAccount(_ input: AddAccountInput) async throws -> Account { try await core.auth.accountService().addAccount(input) }

    /// Opens the Google sign-in page through the configured `OAuthBrowser`. A closed page throws `FlintError.googleSignInCancelled`.
    public func addGoogleAccount(loginHint: String? = nil) async throws -> Account {
        try await core.auth.accountService().addGoogleAccount(loginHint: loginHint)
    }

    public func updateAccount(id: AccountID, _ patch: AccountPatch) async throws -> Account {
        try await core.auth.accountService().updateAccount(id, patch)
    }

    /// Removes the account, its mail and its saved sign-in.
    public func removeAccount(id: AccountID) async throws { try await core.auth.accountService().removeAccount(id) }

    // MARK: Settings

    public func currentSettings() async throws -> Settings { try await core.store.settings() }

    /// Deep-merges a partial JSON patch (objects merge key by key, arrays and scalars replace).
    @discardableResult
    public func updateSettings(patch: JSONValue) async throws -> Settings {
        let before = try await core.store.settings()
        let after = try await core.store.updateSettings(patch)
        core.emit(.settings(after))
        // A corrected Google client lets accounts that stopped on a sign-in error try again.
        if before.google.clientId != after.google.clientId { await core.sync.restartAuthErrors() }
        if before.receipts.enabled != after.receipts.enabled || before.receipts.endpoint != after.receipts.endpoint { core.pump.poke() }
        return after
    }

    /// Stores a whole `Settings` value (every key is written).
    @discardableResult
    public func updateSettings(_ settings: Settings) async throws -> Settings {
        let data = try JSONEncoder().encode(settings)
        return try await updateSettings(patch: try JSONDecoder().decode(JSONValue.self, from: data))
    }

    // MARK: Read receipts

    /// Tracked messages, newest first. `unopened` true lists mail nobody opened or replied to, false mail somebody did.
    public func listTracked(limit: Int? = 100, unopened: Bool? = nil) async throws -> [TrackedMessage] {
        try await core.store.listTracked(limit: limit, unopenedOnly: unopened)
    }

    public func receipt(trackedId: Int) async throws -> ReceiptDetail { try await core.store.receiptDetail(trackedId: trackedId) }

    /// Fetches new open events from the receipts service now.
    public func refreshReceipts() async throws {
        guard await core.receipts.isConfigured() else { throw FlintError(.invalid, "Read receipts need a service address. Add one in Settings.") }
        _ = try await core.receipts.pollEvents()
    }

    public func stopTracking(trackedId: Int) async throws {
        try await core.receipts.stopTracking(trackedId)
        core.emit(.mailChanged(accountId: (try? await core.store.tracked(id: trackedId))?.accountId ?? "", threadIds: []))
    }

    // MARK: Verification codes

    /// Codes detected in the last ten minutes (not expired), newest first, used ones included.
    public func recentCodes() async -> [VerificationCode] { await core.codes.list() }

    /// The user copied or filled this code.
    public func markCodeUsed(id: String) async {
        guard let code = await core.codes.markUsed(id) else { return }
        core.emit(.mailChanged(accountId: code.accountId, threadIds: [code.threadId]))
    }
}
