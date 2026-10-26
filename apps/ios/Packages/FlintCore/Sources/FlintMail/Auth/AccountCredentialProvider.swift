// Turns an account's stored secret into a login credential, refreshing Google access tokens 5 minutes early (track 2C).
// Port of `resolveAuth` in packages/core/src/mail/connect.ts. One refresh per account at a time: concurrent callers
// (command connection, IDLE connection, SMTP) share the same in-flight task, so a rotated refresh token is never raced.

import FlintModel
import Foundation

/// Told when an account can no longer sign in, so the sync status can become `auth_error` ("Sign in again").
/// Transient failures (network, Google 5xx) are not reported.
public protocol AuthFailureSink: Sendable {
    func authFailed(accountID: AccountID, message: String) async
}

public actor AccountCredentialProvider {
    private let secrets: any SecretStore
    private let oauth: GoogleOAuthClient
    private let now: @Sendable () -> Date
    private let failureSink: (any AuthFailureSink)?
    private var inFlight: [AccountID: Task<MailCredential, Error>] = [:]

    public init(
        secrets: any SecretStore, oauth: GoogleOAuthClient, now: @escaping @Sendable () -> Date = { Date() },
        failureSink: (any AuthFailureSink)? = nil
    ) {
        self.secrets = secrets
        self.oauth = oauth
        self.now = now
        self.failureSink = failureSink
    }

    /// Credentials for IMAP and SMTP. Throws `.auth` when the account must sign in again, `.network` when Google is unreachable.
    public func credential(for account: Account) async throws -> MailCredential {
        if let running = inFlight[account.id] { return try await running.value }
        let task = Task { try await self.resolve(account) }
        inFlight[account.id] = task
        defer { inFlight[account.id] = nil }
        do {
            return try await task.value
        } catch let error as FlintError {
            if error.code == .auth { await failureSink?.authFailed(accountID: account.id, message: error.message) }
            throw error
        }
    }

    private func resolve(_ account: Account) async throws -> MailCredential {
        let user = account.server.username
        switch try await secrets.readAccountSecret(account.id) {
        case .password(let password):
            return .password(user: user, password: password)
        case .oauth(let accessToken, let refreshToken, let expiresAt):
            let nowMs = Int(now().timeIntervalSince1970 * 1000)
            if !GoogleOAuthConfig.needsRefresh(expiresAt: expiresAt, nowMs: nowMs) { return .xoauth2(user: user, accessToken: accessToken) }
            let next = try await oauth.refresh(refreshToken: refreshToken)
            try await secrets.writeAccountSecret(account.id, .oauth(accessToken: next.accessToken, refreshToken: next.refreshToken, expiresAt: next.expiresAt))
            return .xoauth2(user: user, accessToken: next.accessToken)
        }
    }
}
