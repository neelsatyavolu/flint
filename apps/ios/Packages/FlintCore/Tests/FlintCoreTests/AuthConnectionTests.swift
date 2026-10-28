import FlintMail
import FlintModel
import Foundation
import Testing

private let server = ServerConfig(imapHost: "imap.example.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.example.com", smtpPort: 465, smtpSecure: true, username: "me@example.com")

private func check(_ fake: FakeMailTransport, server: ServerConfig = server, credential: MailCredential = .password(user: "me@example.com", password: "pw")) async -> ConnectionCheck {
    await testConnection(server: server, credential: credential, transport: { fake })
}

@Suite("Auth testConnection")
struct AuthConnectionTests {
    @Test func successLogsInOverImapThenVerifiesSmtp() async {
        let fake = FakeMailTransport()
        let result = await check(fake)
        #expect(result.isOK)
        #expect(result.imap == .ok && result.smtp == .ok)
        #expect(await fake.calls == ["connect", "verifySend", "disconnect"])
        #expect(await fake.configuration?.imap.host == "imap.example.com")
        #expect(await fake.isConnected == false)
    }

    @Test func authFailureSaysWhichServerAndKeepsCredentialsOutOfTheMessage() async {
        let fake = FakeMailTransport()
        await fake.rejectLogins()
        let result = await check(fake, credential: .password(user: "me@example.com", password: "TOPSECRET"))
        #expect(!result.isOK)
        guard case .failed(let e) = result.imap else { Issue.record("imap should fail"); return }
        #expect(e.code == .auth)
        #expect(e.message == "The server rejected the username or password.")
        #expect(!e.message.contains("TOPSECRET"))
        // SMTP is not attempted after an IMAP login failure; its row stays neutral so the form points at IMAP only.
        #expect(result.smtp == .skipped)
    }

    @Test func appPasswordProvidersGetAdvice() async {
        let fake = FakeMailTransport()
        await fake.rejectLogins()
        var gmail = server
        gmail.imapHost = "imap.gmail.com"
        guard case .failed(let e) = await check(fake, server: gmail).imap else { Issue.record("should fail"); return }
        #expect(e.message == "The server rejected the username or password. This provider needs an app password.")
    }

    @Test func smtpFailureIsReportedSeparately() async {
        let fake = FakeMailTransport()
        await fake.failNext("verifySend", with: FlintError(.auth, "bad"))
        let result = await check(fake)
        #expect(result.imap == .ok)
        guard case .failed(let e) = result.smtp else { Issue.record("smtp should fail"); return }
        #expect(e.message == "The server rejected the username or password.")
        #expect(await fake.calls.last == "disconnect")
    }

    @Test func networkFailureUsesTheDesignVoiceWithHost() async {
        let fake = FakeMailTransport()
        await fake.failNext("connect", with: FlintError(.network, "ECONNREFUSED"))
        guard case .failed(let e) = await check(fake).imap else { Issue.record("should fail"); return }
        #expect(e.code == .network)
        #expect(e.message == "Couldn't reach imap.example.com. Check the server name or your connection.")
    }

    @Test func smtpNetworkFailureNamesTheSmtpHost() async {
        let fake = FakeMailTransport()
        await fake.failNext("verifySend", with: FlintError(.network, "timeout"))
        guard case .failed(let e) = await check(fake).smtp else { Issue.record("should fail"); return }
        #expect(e.message == "Couldn't reach smtp.example.com. Check the server name or your connection.")
    }

    @Test func certificateAndBusyServerGetTheirOwnText() async {
        let fake = FakeMailTransport()
        await fake.failNext("connect", with: FlintError(.network, "TLS certificate is not trusted"))
        guard case .failed(let cert) = await check(fake).imap else { Issue.record("should fail"); return }
        #expect(cert.message == "The IMAP server's security certificate was not accepted.")
        await fake.failNext("connect", with: FlintError(.network, "Too many simultaneous connections, try again later"))
        guard case .failed(let busy) = await check(fake).imap else { Issue.record("should fail"); return }
        #expect(busy.message == "The IMAP server is busy or temporarily unavailable. Flint will try again.")
    }

    @Test func gmailLookupFailureIsNotAPasswordProblem() async {
        let fake = FakeMailTransport()
        await fake.failNext("connect", with: FlintError(.auth, "NO [AUTHENTICATIONFAILED] Lookup failed"))
        guard case .failed(let e) = await check(fake).imap else { Issue.record("should fail"); return }
        #expect(e.message == "The IMAP server has no mailbox for this account.")
        #expect(isGmailLookupFailure(e))
    }

    @Test func nonFlintErrorsGetAGenericLine() async {
        struct Boom: Error {}
        let result = await testConnection(server: server, credential: .password(user: "u", password: "p"), transport: { ThrowingTransport() })
        guard case .failed(let e) = result.imap else { Issue.record("should fail"); return }
        #expect(e.message == "IMAP connection failed.")
    }

    @Test func oauthCredentialReachesTheTransport() async {
        let fake = FakeMailTransport()
        _ = await check(fake, credential: .xoauth2(user: "me@gmail.com", accessToken: "at"))
        guard case .xoauth2(_, let token)? = await fake.configuration?.credential else { Issue.record("wrong credential"); return }
        #expect(token == "at")
    }
}

/// A transport whose connect throws a non-FlintError.
private struct ThrowingTransport: MailTransport {
    struct Boom: Error {}
    func connect(_ configuration: MailTransportConfiguration) async throws { throw Boom() }
    func updateCredential(_ credential: MailCredential) async {}
    func disconnect() async {}
    var isConnected: Bool { get async { false } }
    var capabilities: TransportCapabilities { get async { TransportCapabilities() } }
    func verifySend() async throws {}
    func listFolders() async throws -> [RemoteFolder] { [] }
    func createFolder(_ path: String) async throws {}
    func select(_ path: String, readOnly: Bool, qresync: QResyncState?) async throws -> SelectResult { throw Boom() }
    func search(_ criteria: SearchCriteria) async throws -> [Int] { [] }
    func fetchEnvelopes(_ uids: UIDSet, options: EnvelopeFetchOptions) async throws -> [RemoteEnvelope] { [] }
    func fetchFlags(_ uids: UIDSet, includeLabels: Bool, changedSince: UInt64?) async throws -> [FlagState] { [] }
    func fetchBodyStructure(uid: Int) async throws -> BodyPart? { nil }
    func fetchPart(uid: Int, part: String) async throws -> Data { Data() }
    func fetchRawMessage(uid: Int) async throws -> Data { Data() }
    func storeFlags(_ uids: UIDSet, flags: [String], mode: FlagMode) async throws {}
    func move(_ uids: UIDSet, to path: String) async throws -> [Int: Int] { [:] }
    func copy(_ uids: UIDSet, to path: String) async throws -> [Int: Int] { [:] }
    func expunge(_ uids: UIDSet) async throws {}
    func append(_ raw: Data, to path: String, flags: [String], date: Date?) async throws -> Int? { nil }
    func idle(mailbox: String) async -> AsyncStream<IdleEvent> { AsyncStream { $0.finish() } }
    func send(_ message: OutgoingMessage) async throws {}
}
