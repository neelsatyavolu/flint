import FlintMail
import FlintModel
import Foundation
import Testing

private let clientId = "123-abc.apps.googleusercontent.com"
private let tokenURL = "https://oauth2.googleapis.com/token"
private let now = Date(timeIntervalSince1970: 1_800_000_000)
private var nowMs: Int { Int(now.timeIntervalSince1970 * 1000) }

private let server = ServerConfig(imapHost: "imap.gmail.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.gmail.com", smtpPort: 465, smtpSecure: true, username: "me@gmail.com")
private func account(_ kind: AuthKind) -> Account {
    Account(id: "a1", email: "me@gmail.com", name: "Me", provider: .gmail, authKind: kind, server: server)
}

private func provider(_ http: ScriptedHTTP, secrets: InMemorySecretStore, sink: RecordingAuthSink = RecordingAuthSink()) -> AccountCredentialProvider {
    AccountCredentialProvider(
        secrets: secrets, oauth: GoogleOAuthClient(config: GoogleOAuthConfig(clientId: clientId), http: http.client, now: { now }),
        now: { now }, failureSink: sink)
}

@Suite("Auth credential provider")
struct AuthCredentialTests {
    @Test func passwordSecretGivesPasswordCredentialForServerUsername() async throws {
        let secrets = InMemorySecretStore()
        try await secrets.writeAccountSecret("a1", .password("hunter2"))
        let credential = try await provider(ScriptedHTTP(), secrets: secrets).credential(for: account(.password))
        guard case .password(let user, let password) = credential else { Issue.record("wrong credential"); return }
        #expect(user == "me@gmail.com")
        #expect(password == "hunter2")
    }

    @Test func freshTokenIsUsedWithoutNetwork() async throws {
        let secrets = InMemorySecretStore()
        try await secrets.writeAccountSecret("a1", .oauth(accessToken: "at-live", refreshToken: "rt", expiresAt: nowMs + 10 * 60 * 1000))
        let http = ScriptedHTTP()
        let credential = try await provider(http, secrets: secrets).credential(for: account(.oauthGoogle))
        guard case .xoauth2(let user, let token) = credential else { Issue.record("wrong credential"); return }
        #expect(user == "me@gmail.com")
        #expect(token == "at-live")
        #expect(await http.requests.isEmpty)
    }

    @Test func tokenInsideMarginIsRefreshedAndWrittenBack() async throws {
        let secrets = InMemorySecretStore()
        try await secrets.writeAccountSecret("a1", .oauth(accessToken: "at-old", refreshToken: "rt", expiresAt: nowMs + 4 * 60 * 1000))
        let http = ScriptedHTTP()
        await http.enqueue(tokenURL, status: 200, json: #"{"access_token":"at-new","expires_in":3600}"#)
        let credential = try await provider(http, secrets: secrets).credential(for: account(.oauthGoogle))
        guard case .xoauth2(_, let token) = credential else { Issue.record("wrong credential"); return }
        #expect(token == "at-new")
        #expect(try await secrets.readAccountSecret("a1") == .oauth(accessToken: "at-new", refreshToken: "rt", expiresAt: nowMs + 3_600_000))
    }

    @Test func rotatedRefreshTokenIsStored() async throws {
        let secrets = InMemorySecretStore()
        try await secrets.writeAccountSecret("a1", .oauth(accessToken: "x", refreshToken: "rt-old", expiresAt: 0))
        let http = ScriptedHTTP()
        await http.enqueue(tokenURL, status: 200, json: #"{"access_token":"y","refresh_token":"rt-new","expires_in":60}"#)
        _ = try await provider(http, secrets: secrets).credential(for: account(.oauthGoogle))
        guard case .oauth(_, let refresh, _) = try await secrets.readAccountSecret("a1") else { Issue.record("wrong secret"); return }
        #expect(refresh == "rt-new")
    }

    @Test func revokedRefreshTokenReportsAuthErrorAndKeepsSecret() async throws {
        let secrets = InMemorySecretStore()
        try await secrets.writeAccountSecret("a1", .oauth(accessToken: "x", refreshToken: "rt", expiresAt: 0))
        let http = ScriptedHTTP()
        await http.enqueue(tokenURL, status: 400, json: #"{"error":"invalid_grant"}"#)
        let sink = RecordingAuthSink()
        let p = provider(http, secrets: secrets, sink: sink)
        await expectAuthError("Google sign-in expired. Sign in again.") { _ = try await p.credential(for: account(.oauthGoogle)) }
        #expect(await sink.count == 1)
        #expect(await sink.failures.first?.0 == "a1")
        #expect(try await secrets.get("account:a1") != nil)
    }

    @Test func networkFailureDoesNotMarkAuthError() async throws {
        let secrets = InMemorySecretStore()
        try await secrets.writeAccountSecret("a1", .oauth(accessToken: "x", refreshToken: "rt", expiresAt: 0))
        let http = ScriptedHTTP()
        await http.enqueueFailure(tokenURL)
        let sink = RecordingAuthSink()
        let p = provider(http, secrets: secrets, sink: sink)
        await expectAuthError("Could not reach Google. Check your connection and try again.", code: .network) { _ = try await p.credential(for: account(.oauthGoogle)) }
        #expect(await sink.count == 0)
    }

    @Test func missingSecretReportsAuthError() async {
        let sink = RecordingAuthSink()
        let p = provider(ScriptedHTTP(), secrets: InMemorySecretStore(), sink: sink)
        await expectAuthError("No saved sign-in for this account. Sign in again.") { _ = try await p.credential(for: account(.password)) }
        #expect(await sink.count == 1)
    }

    @Test func concurrentCallersShareOneRefresh() async throws {
        let secrets = InMemorySecretStore()
        try await secrets.writeAccountSecret("a1", .oauth(accessToken: "x", refreshToken: "rt", expiresAt: 0))
        let http = ScriptedHTTP()
        await http.enqueue(tokenURL, status: 200, json: #"{"access_token":"y","expires_in":3600}"#)
        let p = provider(http, secrets: secrets)
        let acct = account(.oauthGoogle)
        let tokens = try await withThrowingTaskGroup(of: String.self) { group in
            for _ in 0..<6 { group.addTask { if case .xoauth2(_, let t) = try await p.credential(for: acct) { return t }; return "" } }
            var out: [String] = []
            for try await t in group { out.append(t) }
            return out
        }
        #expect(tokens == Array(repeating: "y", count: 6))
        #expect(await http.requests.count == 1)
    }
}
