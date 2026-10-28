import Darwin
import FlintModel
import FlintService
import FlintStore
import Foundation
import Testing
@testable import FlintMail

/// A listener that accepts connections and closes them at once: what a middlebox that kills TLS looks like to the client.
private final class SlammingListener: @unchecked Sendable {
    let port: Int
    private let fd: Int32

    init() throws {
        let socketFD = socket(AF_INET, SOCK_STREAM, 0)
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_addr.s_addr = inet_addr("127.0.0.1")
        let size = socklen_t(MemoryLayout<sockaddr_in>.size)
        let bound = withUnsafePointer(to: &address) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(socketFD, $0, size) } }
        guard bound == 0, listen(socketFD, 8) == 0 else { close(socketFD); throw FlintError(.internal, "Could not open a local listener.") }
        var length = size
        _ = withUnsafeMutablePointer(to: &address) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(socketFD, $0, &length) } }
        fd = socketFD
        port = Int(UInt16(bigEndian: address.sin_port))
        DispatchQueue(label: "flint.slammer").async { while true { let client = accept(socketFD, nil, nil); if client < 0 { return }; close(client) } }
    }

    deinit { shutdown(fd, SHUT_RDWR); close(fd) }
}

private func tlsConfig(host: String = "127.0.0.1", imapPort: Int, secure: Bool, user: String = "u", password: String = "p") -> MailTransportConfiguration {
    let server = ServerConfig(imapHost: host, imapPort: imapPort, imapSecure: secure, smtpHost: host, smtpPort: imapPort, smtpSecure: secure, username: user)
    return MailTransportConfiguration(server: server, credential: .password(user: user, password: password))
}

@Suite("GreenMail flaky network", .enabled(if: mailGreenMailEnabled), .serialized)
struct MailGreenMailFlakyNetworkTests {
    // MARK: TLS failure

    @Test func implicitTLSAgainstAPlainServerIsANetworkErrorNotAnAuthError() async throws {
        let (server, user) = try await MailSharedGreenMail.shared.freshUser()
        let transport = SwiftMailTransport()
        do {
            try await transport.connect(tlsConfig(imapPort: server.imapPort, secure: true, user: user, password: MailGreenMailServer.password))
            Issue.record("a TLS handshake with a plain server must fail")
        } catch let error as FlintError {
            #expect(error.code == .network)
            #expect(!error.message.contains(MailGreenMailServer.password))
        }
    }

    @Test func aPeerThatDropsTheConnectionDuringTheHandshakeIsANetworkError() async throws {
        let listener = try SlammingListener()
        for secure in [true, false] {
            let transport = SwiftMailTransport()
            do {
                try await transport.connect(tlsConfig(imapPort: listener.port, secure: secure))
                Issue.record("connect must fail (secure: \(secure))")
            } catch let error as FlintError { #expect(error.code == .network, "secure: \(secure)") }
        }
    }

    @Test func aSessionOnABrokenTLSEndpointRetriesQuietlyAndNeverReportsAuthError() async throws {
        let (server, user) = try await MailSharedGreenMail.shared.freshUser()
        var account = server.account(for: user)
        account.server = ServerConfig(imapHost: "127.0.0.1", imapPort: server.imapPort, imapSecure: true, smtpHost: "127.0.0.1", smtpPort: server.smtpPort, smtpSecure: true, username: user)
        let store = MailTestStore()
        await store.addAccount(account)
        var config = SessionConfiguration(cacheRoot: FileManager.default.temporaryDirectory)
        config.backoffMinimum = .milliseconds(100)
        config.backoffMaximum = .milliseconds(300)
        let credential = server.credential(user)
        let session = AccountSession(accountId: "a1", store: store, transportFactory: SwiftMailTransport.factory, credentials: { credential }, emit: { _ in }, configuration: config)
        await session.start()
        let failing = await mailEventually(timeout: .seconds(10)) {
            let state = await session.status.state
            return state == .error || state == .offline
        }
        #expect(failing)
        try await Task.sleep(for: .seconds(1))
        let state = await session.status.state
        #expect(state != .authError && state != .idle)
        await session.stop()
    }

    // MARK: Server restart mid-IDLE

    /// True when `matches` fires on the stream before `timeout`. The reader task is a child of the group, so cancelling the group stops it.
    private func sees(_ stream: AsyncStream<IdleEvent>, within timeout: Duration, _ matches: @escaping @Sendable (IdleEvent) -> Bool) async -> Bool {
        await withTaskGroup(of: Bool.self) { group in
            group.addTask { for await event in stream where matches(event) { return true }; return false }
            group.addTask { try? await Task.sleep(for: timeout); return false }
            let first = await group.next() ?? false
            group.cancelAll()
            return first
        }
    }

    @Test func afterAServerRestartAFreshConnectionIdlesAndWakesOnNewMail() async throws {
        let server = MailGreenMailServer(users: ["idle1", "sender"])
        try await server.start()
        defer { server.stop() }
        let first = try await server.connect("idle1")
        let stream = await first.idle(mailbox: "INBOX")
        try await Task.sleep(for: .milliseconds(800))
        try await server.restart()
        // SwiftMail's IDLE runner reconnects on its own and may keep the stream open, so the stream ending is not required here.
        let ended = await sees(stream, within: .seconds(3)) { if case .disconnected = $0 { return true } else { return false } }
        print("[flaky] idle stream reported the restart as a disconnect: \(ended)")
        await first.disconnect()

        let second = try await server.connect("idle1")
        let again = await second.idle(mailbox: "INBOX")
        async let woke = sees(again, within: .seconds(10)) { if case .newMessages = $0 { return true } else { return false } }
        try await Task.sleep(for: .milliseconds(800))
        _ = try await server.deliver(to: "idle1", subject: "after the restart")
        #expect(await woke)
        await second.disconnect()
    }

    /// The IDLE connection survives a restart only through SwiftMail's silent reconnect, and mail that lands while it redials is not pushed
    /// (the SELECT after the redial reports it as part of the select, not as an IDLE event). The engine's safety poll is what catches it,
    /// so this test pins the contract: with a short safety poll the message shows up without anybody nudging the session.
    @Test func theSessionPicksUpMailDeliveredWhileIdleRedialsAfterARestart() async throws {
        let server = MailGreenMailServer(users: ["idle2", "sender"])
        try await server.start()
        defer { server.stop() }
        let store = MailTestStore()
        await store.addAccount(server.account(for: "idle2"))
        await store.setOwnAddresses([server.email("idle2")])
        let log = MailEventLog()
        var config = SessionConfiguration(cacheRoot: FileManager.default.temporaryDirectory.appendingPathComponent("flint-gm-\(UUID().uuidString)"))
        config.pollInterval = .seconds(5)
        config.idlePollInterval = .seconds(5)
        config.backoffMinimum = .milliseconds(200)
        config.backoffMaximum = .seconds(1)
        let credential = server.credential("idle2")
        let session = AccountSession(accountId: "a1", store: store, transportFactory: SwiftMailTransport.factory, credentials: { credential }, emit: { log.add($0) }, configuration: config)
        await session.start()
        let settled = await mailEventually(timeout: .seconds(20)) { await session.status.state == .idle }
        #expect(settled)
        try await Task.sleep(for: .seconds(1)) // IDLE is running
        try await server.restart()
        try await Task.sleep(for: .milliseconds(500))
        _ = try await server.deliver(to: "idle2", subject: "pushed after restart")
        let arrived = await mailEventually(timeout: .seconds(40)) {
            guard let folder = try? await store.folder(accountId: "a1", path: "INBOX") else { return false }
            return await store.allMessages(in: folder.id).map(\.subject) == ["pushed after restart"]
        }
        #expect(arrived)
        let state = await session.status.state
        #expect(state != .authError)
        await session.stop()
    }

    /// Mail that lands while IDLE redials is not pushed. The transport reports the redial as `.reconnected`, so the session syncs at
    /// once: the safety polls here are 600 s and the wait is 25 s, so only the event can explain the message showing up.
    @Test func theSessionSyncsAtOnceWhenIdleRedialsAndNeverWaitsForThePoll() async throws {
        FlintLogging.bootstrap() // the reconnect signal travels through the privacy log handler
        let (server, user) = try await MailSharedGreenMail.shared.freshUser()
        let store = MailTestStore()
        await store.addAccount(server.account(for: user))
        await store.setOwnAddresses([server.email(user)])
        var config = SessionConfiguration(cacheRoot: FileManager.default.temporaryDirectory.appendingPathComponent("flint-gm-\(UUID().uuidString)"))
        config.pollInterval = .seconds(600)
        config.idlePollInterval = .seconds(600)
        config.backoffMinimum = .milliseconds(200)
        config.backoffMaximum = .seconds(1)
        let credential = server.credential(user)
        let session = AccountSession(accountId: "a1", store: store, transportFactory: SwiftMailTransport.factory, credentials: { credential }, emit: { _ in }, configuration: config)
        await session.start()
        let settled = await mailEventually(timeout: .seconds(20)) { await session.status.state == .idle }
        #expect(settled)
        try await Task.sleep(for: .seconds(1)) // IDLE is running
        async let blip: Void = server.blip(downFor: .seconds(2))
        try await Task.sleep(for: .milliseconds(500))
        try server.deliverBySMTP(to: user, subject: "delivered during the redial") // SMTP is not behind the proxy
        try await blip
        let arrived = await mailEventually(timeout: .seconds(25)) {
            guard let folder = try? await store.folder(accountId: "a1", path: "INBOX") else { return false }
            return await store.allMessages(in: folder.id).map(\.subject).contains("delivered during the redial")
        }
        #expect(arrived, "the redial must wake the session; the 600 s poll cannot have run")
        await session.stop()
    }

    @Test func aNetworkBlipWhileIdlingNeverLosesMailThatArrivesDuringTheGap() async throws {
        let (server, user) = try await MailSharedGreenMail.shared.freshUser()
        let store = MailTestStore()
        await store.addAccount(server.account(for: user))
        await store.setOwnAddresses([server.email(user)])
        let log = MailEventLog()
        var config = SessionConfiguration(cacheRoot: FileManager.default.temporaryDirectory.appendingPathComponent("flint-gm-\(UUID().uuidString)"))
        config.pollInterval = .seconds(5)
        config.idlePollInterval = .seconds(5)
        config.backoffMinimum = .milliseconds(200)
        config.backoffMaximum = .seconds(1)
        let credential = server.credential(user)
        let session = AccountSession(accountId: "a1", store: store, transportFactory: SwiftMailTransport.factory, credentials: { credential }, emit: { log.add($0) }, configuration: config)
        await session.start()
        let settled = await mailEventually(timeout: .seconds(20)) { await session.status.state == .idle }
        #expect(settled)
        try await Task.sleep(for: .seconds(1))
        async let blip: Void = server.blip(downFor: .seconds(2))
        try await Task.sleep(for: .milliseconds(500))
        try server.deliverBySMTP(to: user, subject: "sent during the gap") // SMTP is not behind the proxy
        try await blip
        let arrived = await mailEventually(timeout: .seconds(40)) {
            log.events.contains { if case .newMail(_, _, _, let subject, _, _, _) = $0 { return subject == "sent during the gap" } else { return false } }
        }
        #expect(arrived)
        let state = await session.status.state
        #expect(state != .authError)
        await session.stop()
    }
}
