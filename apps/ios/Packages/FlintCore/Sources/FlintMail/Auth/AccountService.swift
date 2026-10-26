// Add, check, edit and remove accounts (track 2C). Port of packages/core/src/service/accounts.ts, minus what belongs to
// other tracks: sync restarts go through `AccountLifecycle`, the database through `AccountsRepository`, and the browser
// step of Google sign-in through `OAuthBrowser`. Nothing is saved until the server has accepted the login.

import FlintModel
import FlintStore
import Foundation

public struct AccountService: Sendable {
    private let accounts: any AccountsRepository
    private let secrets: any SecretStore
    private let lifecycle: any AccountLifecycle
    private let transport: MailTransportFactory
    private let oauth: GoogleOAuthClient
    private let autoconfigDeps: AutoconfigDeps
    private let browser: any OAuthBrowser
    private let now: @Sendable () -> Date

    public init(
        accounts: any AccountsRepository, secrets: any SecretStore, lifecycle: any AccountLifecycle,
        transport: @escaping MailTransportFactory, oauth: GoogleOAuthClient, autoconfigDeps: AutoconfigDeps = .live,
        browser: any OAuthBrowser, now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.accounts = accounts
        self.secrets = secrets
        self.lifecycle = lifecycle
        self.transport = transport
        self.oauth = oauth
        self.autoconfigDeps = autoconfigDeps
        self.browser = browser
        self.now = now
    }

    // MARK: Reading

    public func listAccounts() async throws -> [Account] { try await accounts.listAccounts() }

    /// Detected server settings for the sign-in form, or nil when nothing could be worked out.
    public func autoconfig(_ email: String) async throws -> AutoconfigResult? {
        try? await FlintMail.autoconfig(email: email, deps: autoconfigDeps).result
    }

    /// Checks the login without saving anything.
    public func testConnection(_ raw: AddAccountInput) async throws -> ConnectionCheck {
        let input = try ValidatedAdd(raw)
        let resolved = try await resolve(input)
        return await check(resolved)
    }

    // MARK: Password accounts

    public func addAccount(_ raw: AddAccountInput) async throws -> Account {
        let input = try ValidatedAdd(raw)
        let existing = try await accounts.account(email: input.email)
        let resolved = try await resolve(input)
        let result = await check(resolved)
        if let failure = result.firstError { throw failure }

        let secret = AccountSecret.password(resolved.password)
        let account: Account
        if let existing {
            // Signing in again, possibly by another method: keep the mail, replace the credentials, method and server, reconnect.
            try await secrets.writeAccountSecret(existing.id, secret)
            account = try await accounts.updateAccount(
                existing.id, AccountPatch(server: resolved.server, provider: resolved.provider, authKind: .password, enabled: true))
        } else {
            account = try await create(
                NewAccount(email: input.email, name: input.name, provider: resolved.provider, authKind: .password, server: resolved.server), secret: secret)
        }
        await lifecycle.restartSync(account.id)
        await lifecycle.accountChanged(account.id)
        return account
    }

    // MARK: Google accounts

    /// Runs the Google sign-in sheet, proves the Gmail mailbox exists, then saves the tokens.
    public func addGoogleAccount(loginHint: String?) async throws -> Account {
        let request = oauth.authorizationRequest(loginHint: loginHint)
        let callback = try await runBrowser(request)
        let code = try extractAuthorizationCode(from: callback, expectedState: request.state)
        let signIn = try await oauth.exchange(code: code, request: request)

        let gmail = ProviderPresets.gmail.server(username: signIn.email)
        let result = await FlintMail.testConnection(server: gmail, credential: .xoauth2(user: signIn.email, accessToken: signIn.accessToken), transport: transport)
        if let failure = result.firstError {
            if isGmailLookupFailure(failure) { throw FlintError(.invalid, await noGmailMessage(for: signIn.email)) }
            throw failure
        }

        let existing = try await accounts.account(email: signIn.email)
        let secret = AccountSecret.oauth(accessToken: signIn.accessToken, refreshToken: signIn.refreshToken, expiresAt: signIn.expiresAt)
        let account: Account
        if let existing {
            try await secrets.writeAccountSecret(existing.id, secret)
            account = try await accounts.updateAccount(
                existing.id, AccountPatch(server: gmail, provider: .gmail, authKind: .oauthGoogle, enabled: true))
        } else {
            account = try await create(
                NewAccount(email: signIn.email, name: signIn.name, provider: .gmail, authKind: .oauthGoogle, server: gmail), secret: secret)
        }
        await lifecycle.restartSync(account.id)
        await lifecycle.accountChanged(account.id)
        return account
    }

    private func runBrowser(_ request: GoogleAuthorizationRequest) async throws -> URL {
        do { return try await browser.authenticate(url: request.url, callbackScheme: request.callbackScheme) }
        catch let error as FlintError { throw error }
        catch { throw FlintError(.auth, "Google sign-in failed.") }
    }

    private func noGmailMessage(for email: String) async -> String {
        let domain = (try? domainOf(email)) ?? ""
        let host = await mxHost(of: domain, resolveMX: autoconfigDeps.resolveMX)
        let name = host.flatMap { $0 == .google ? nil : $0.displayName } ?? "another provider"
        return "This Google account doesn't have a Gmail inbox. Its mail is handled by \(name)."
    }

    // MARK: Edit and remove

    public func updateAccount(_ id: AccountID, _ raw: AccountPatch) async throws -> Account {
        guard let before = try await accounts.account(id: id) else { throw FlintError(.notFound, "No such account.") }
        let patch = try validated(raw)
        let account = try await accounts.updateAccount(id, patch)
        if let enabled = patch.enabled, enabled != before.enabled { await lifecycle.restartSync(id) }
        await lifecycle.accountChanged(id)
        return account
    }

    public func removeAccount(_ id: AccountID) async throws {
        guard try await accounts.account(id: id) != nil else { throw FlintError(.notFound, "No such account.") }
        await lifecycle.forgetSync(id)
        try await secrets.delete(secretKey(for: id))
        try await accounts.deleteAccount(id)
        await lifecycle.accountChanged(id)
    }

    // MARK: Helpers

    /// Saves the credentials first so a created account always has them; undoes that if the database refuses the account.
    private func create(_ draft: NewAccount, secret: AccountSecret) async throws -> Account {
        var input = draft
        let id = UUID().uuidString.lowercased()
        input.id = id
        input.createdAt = Int(now().timeIntervalSince1970 * 1000)
        try await secrets.writeAccountSecret(id, secret)
        do { return try await accounts.createAccount(input) }
        catch {
            try? await secrets.delete(secretKey(for: id))
            throw error
        }
    }

    private struct Resolved {
        let server: ServerConfig
        let provider: MailProvider
        let password: String
    }

    private func resolve(_ input: ValidatedAdd) async throws -> Resolved {
        let server: ServerConfig, provider: MailProvider
        if let given = input.server {
            (server, provider) = (given, input.provider ?? .imap)
        } else {
            let found = try await FlintMail.autoconfig(email: input.email, deps: autoconfigDeps)
            (server, provider) = (found.server, input.provider ?? found.provider)
        }
        // Google shows app passwords in groups separated by spaces.
        let password = provider == .gmail ? input.password.filter { !$0.isWhitespace } : input.password
        return Resolved(server: server, provider: provider, password: password)
    }

    private func check(_ r: Resolved) async -> ConnectionCheck {
        await FlintMail.testConnection(server: r.server, credential: .password(user: r.server.username, password: r.password), transport: transport)
    }

    private func validated(_ raw: AccountPatch) throws -> AccountPatch {
        if raw.email != nil || raw.server != nil || raw.provider != nil || raw.authKind != nil || raw.avatarSource != nil || raw.avatarUpdatedAt != nil {
            throw FlintError(.invalid, "Sign in again to change the address or server.")
        }
        var patch = raw
        if let name = raw.name {
            patch.name = try Validation.name(name)
        }
        if case .some(.some(let color)) = raw.color, color.count > 40 { throw FlintError(.invalid, "That color is not valid.") }
        if let aliases = raw.aliases {
            guard aliases.count <= 50 else { throw FlintError(.invalid, "Use no more than 50 aliases.") }
            patch.aliases = try aliases.map(Validation.email)
        }
        return patch
    }
}

private enum Validation {
    static func email(_ raw: String) throws -> String {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let parts = value.split(separator: "@", omittingEmptySubsequences: false)
        guard parts.count == 2, !parts[0].isEmpty, parts[1].contains("."), !parts[1].hasPrefix("."), !parts[1].hasSuffix("."),
              !value.contains(where: { $0.isWhitespace })
        else { throw FlintError(.invalid, "Enter a full email address.") }
        return value
    }

    static func name(_ raw: String) throws -> String {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.count <= 200 else { throw FlintError(.invalid, "That name is too long.") }
        return value
    }
}

/// `AddAccountInput` after trimming and checking, before any network.
private struct ValidatedAdd {
    let email: String
    let name: String
    let password: String
    let provider: MailProvider?
    let server: ServerConfig?

    init(_ raw: AddAccountInput) throws {
        email = try Validation.email(raw.email)
        name = try Validation.name(raw.name)
        guard !raw.password.isEmpty else { throw FlintError(.invalid, "Enter the password.") }
        password = raw.password
        provider = raw.provider
        if let s = raw.server {
            let trimmed = ServerConfig(
                imapHost: s.imapHost.trimmingCharacters(in: .whitespaces), imapPort: s.imapPort, imapSecure: s.imapSecure,
                smtpHost: s.smtpHost.trimmingCharacters(in: .whitespaces), smtpPort: s.smtpPort, smtpSecure: s.smtpSecure,
                username: s.username.trimmingCharacters(in: .whitespaces))
            guard !trimmed.imapHost.isEmpty, !trimmed.smtpHost.isEmpty, !trimmed.username.isEmpty,
                  (1...65535).contains(trimmed.imapPort), (1...65535).contains(trimmed.smtpPort)
            else { throw FlintError(.invalid, "Enter the server settings.") }
            server = trimmed
        } else {
            server = nil
        }
    }
}
