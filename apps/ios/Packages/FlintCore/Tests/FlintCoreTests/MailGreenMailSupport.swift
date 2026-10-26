import Darwin
import FlintModel
import Foundation
@testable import FlintMail

/// True when the GreenMail suites should run (`FLINT_GREENMAIL=1`). They need Java and python3 and start real servers.
let mailGreenMailEnabled = ProcessInfo.processInfo.environment["FLINT_GREENMAIL"] == "1"

nonisolated(unsafe) private var runningScripts = [pid_t]()
private let runningLock = NSLock()

private func registerForCleanup(_ pid: pid_t) {
    runningLock.lock(); runningScripts.append(pid); runningLock.unlock()
    struct Once { nonisolated(unsafe) static var installed = false }
    runningLock.lock()
    if !Once.installed {
        Once.installed = true
        atexit {
            runningLock.lock()
            for pid in runningScripts { kill(pid, SIGTERM) }
            runningLock.unlock()
        }
    }
    runningLock.unlock()
}

private func freePort() -> Int {
    let fd = socket(AF_INET, SOCK_STREAM, 0)
    defer { close(fd) }
    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_addr.s_addr = inet_addr("127.0.0.1")
    address.sin_port = 0
    _ = withUnsafePointer(to: &address) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) } }
    var length = socklen_t(MemoryLayout<sockaddr_in>.size)
    _ = withUnsafeMutablePointer(to: &address) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(fd, $0, &length) } }
    return Int(UInt16(bigEndian: address.sin_port))
}

private func portOpen(_ port: Int) -> Bool {
    let fd = socket(AF_INET, SOCK_STREAM, 0)
    defer { close(fd) }
    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_addr.s_addr = inet_addr("127.0.0.1")
    address.sin_port = UInt16(port).bigEndian
    return withUnsafePointer(to: &address) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) } } == 0
}

/// A private GreenMail with the IMAP fix-up proxy in front of it, started through `apps/ios/scripts/greenmail.sh`.
final class MailGreenMailServer: @unchecked Sendable {
    let imapPort: Int      // the proxy: what the engine connects to
    let rawImapPort: Int
    let smtpPort: Int
    let apiPort: Int
    let users: [String]
    private var process: Process?

    static let domain = "test.local"
    static let password = "secret"

    init(users: [String], ports: (imap: Int, smtp: Int)? = nil) {
        self.users = users
        imapPort = ports?.imap ?? freePort()
        smtpPort = ports?.smtp ?? freePort()
        rawImapPort = freePort()
        apiPort = freePort()
    }

    private static var scriptURL: URL {
        // apps/ios/Packages/FlintCore/Tests/FlintCoreTests/<file> -> apps/ios/scripts/greenmail.sh
        var url = URL(fileURLWithPath: #filePath).resolvingSymlinksInPath()
        for _ in 0..<5 { url = url.deletingLastPathComponent() }
        return url.appendingPathComponent("scripts/greenmail.sh")
    }

    func start() async throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = [
            Self.scriptURL.path, "--imap", "\(rawImapPort)", "--proxy", "\(imapPort)", "--smtp", "\(smtpPort)", "--api", "\(apiPort)", "--users", users.joined(separator: ","),
        ]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
        self.process = process
        registerForCleanup(process.processIdentifier)
        for _ in 0..<150 {
            if !process.isRunning { throw FlintError(.internal, "GreenMail exited early. Is Java installed?") }
            if portOpen(imapPort) && portOpen(rawImapPort) && portOpen(smtpPort) { return }
            try await Task.sleep(for: .milliseconds(200))
        }
        stop()
        throw FlintError(.internal, "GreenMail did not open its ports in time.")
    }

    func stop() {
        guard let process else { return }
        if process.isRunning { process.terminate(); process.waitUntilExit() }
        self.process = nil
    }

    /// Stops the server and starts a fresh one on the same ports (mailboxes start empty, UIDVALIDITY changes).
    func restart() async throws {
        stop()
        for _ in 0..<50 where portOpen(imapPort) || portOpen(smtpPort) { try await Task.sleep(for: .milliseconds(100)) }
        try await start()
    }

    // MARK: Helpers for tests

    func email(_ user: String) -> String { "\(user)@\(Self.domain)" }

    func server(for user: String) -> ServerConfig {
        ServerConfig(imapHost: "127.0.0.1", imapPort: imapPort, imapSecure: false, smtpHost: "127.0.0.1", smtpPort: smtpPort, smtpSecure: false, username: user)
    }

    func credential(_ user: String) -> MailCredential { .password(user: user, password: Self.password) }

    func configuration(for user: String) -> MailTransportConfiguration { MailTransportConfiguration(server: server(for: user), credential: credential(user)) }

    func account(for user: String, id: AccountID = "a1") -> Account {
        Account(id: id, email: email(user), name: user.capitalized, provider: .imap, authKind: .password, server: server(for: user))
    }

    /// A connected transport for `user`.
    func connect(_ user: String) async throws -> SwiftMailTransport {
        let transport = SwiftMailTransport()
        try await transport.connect(configuration(for: user))
        return transport
    }

    /// Delivers a message from outside, the way a remote sender would (SMTP into the user's INBOX).
    @discardableResult
    func deliver(
        to user: String, subject: String, from: String = "Sender <sender@remote.example>", html: String? = nil, text: String? = nil, headers: [String: String] = [:],
        attachments: [DraftAttachment] = [], messageId: String? = nil, date: Date? = nil, inReplyTo: String? = nil, references: [String] = []
    ) async throws -> String {
        let sender = try await connect("sender")
        defer { Task { await sender.disconnect() } }
        let fromAddress = Address(name: from.contains("<") ? String(from.prefix(while: { $0 != "<" })).trimmingCharacters(in: .whitespaces) : "", address: from.contains("<") ? String(from.split(separator: "<")[1].dropLast()) : from)
        let id = messageId ?? MimeBuilder.newMessageId(fromAddress: fromAddress.address)
        let input = MimeInput(
            from: fromAddress, to: [Address(address: email(user))], subject: subject, html: html ?? "<p>\(text ?? "Hello")</p>", text: text, attachments: attachments,
            messageId: id, inReplyTo: inReplyTo, references: references, headers: headers, date: date)
        try await sender.send(OutgoingMessage(envelopeFrom: fromAddress.address, recipients: [email(user)], raw: try MimeBuilder.build(input)))
        return id
    }
}

/// One GreenMail for the whole run, with `u01...` users and the "sender".
actor MailSharedGreenMail {
    static let shared = MailSharedGreenMail()
    private var server: MailGreenMailServer?
    private var next = 0
    static let userCount = 60

    func get() async throws -> MailGreenMailServer {
        if let server { return server }
        let created = MailGreenMailServer(users: (1...Self.userCount).map { String(format: "u%02d", $0) } + ["sender"])
        try await created.start()
        server = created
        return created
    }

    /// A user nobody has used yet.
    func freshUser() async throws -> (server: MailGreenMailServer, user: String) {
        let server = try await get()
        next += 1
        precondition(next <= Self.userCount, "raise MailSharedGreenMail.userCount")
        return (server, String(format: "u%02d", next))
    }
}
