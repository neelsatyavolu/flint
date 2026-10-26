// The Google client, the credential provider and the account service, rebuilt together when the client id in Settings
// changes. Sessions ask `credential(for:)` on every connect, so they follow a rebuild without restarting.

import FlintMail
import FlintModel
import FlintStore
import Foundation
import Synchronization

final class AuthStack: Sendable {
    private struct Built {
        var clientId: String
        var provider: AccountCredentialProvider
        var accounts: AccountService
    }

    private let store: any Store
    private let secrets: any SecretStore
    private let http: HTTPClient
    private let autoconfig: AutoconfigDeps
    private let transport: MailTransportFactory
    private let browser: any OAuthBrowser
    private let lifecycle: any AccountLifecycle
    private let failures: any AuthFailureSink
    private let now: @Sendable () -> EpochMs
    private let built: Mutex<Built?> = Mutex(nil)

    init(
        store: any Store, secrets: any SecretStore, http: HTTPClient, autoconfig: AutoconfigDeps, transport: @escaping MailTransportFactory,
        browser: any OAuthBrowser, lifecycle: any AccountLifecycle, failures: any AuthFailureSink, now: @escaping @Sendable () -> EpochMs
    ) {
        self.store = store
        self.secrets = secrets
        self.http = http
        self.autoconfig = autoconfig
        self.transport = transport
        self.browser = browser
        self.lifecycle = lifecycle
        self.failures = failures
        self.now = now
    }

    /// The client id in effect: the Settings override when set, else the built-in one.
    private func clientId() async -> String {
        let override = (try? await store.settings().google.clientId)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return override.isEmpty ? FlintServiceConfiguration.builtInGoogleClientId : override
    }

    /// The client id in effect right now (for diagnostics and tests).
    func currentClientId() async -> String { await current().clientId }

    private func current() async -> Built {
        let id = await clientId()
        if let existing = built.withLock({ $0 }), existing.clientId == id { return existing }
        let oauth = GoogleOAuthClient(config: GoogleOAuthConfig(clientId: id), http: http)
        let provider = AccountCredentialProvider(secrets: secrets, oauth: oauth, failureSink: failures)
        let accounts = AccountService(
            accounts: store, secrets: secrets, lifecycle: lifecycle, transport: transport, oauth: oauth, autoconfigDeps: autoconfig,
            browser: browser)
        let next = Built(clientId: id, provider: provider, accounts: accounts)
        built.withLock { $0 = next }
        return next
    }

    func accountService() async -> AccountService { await current().accounts }

    func credential(for accountId: AccountID) async throws -> MailCredential {
        guard let account = try await store.account(id: accountId) else { throw FlintError(.notFound, "That account no longer exists.") }
        return try await current().provider.credential(for: account)
    }
}
