import Foundation
import Network
import SwiftMail

/// Tiny plaintext IMAP stub: advertises AUTH=XOAUTH2, checks the SASL string, answers OK.
final class StubIMAP: @unchecked Sendable {
    private let listener: NWListener
    private let lock = NSLock()
    private(set) var sasl: String?
    private let advertiseSASLIR: Bool
    private var pendingTag: String?
    init(saslIR: Bool) throws {
        advertiseSASLIR = saslIR
        listener = try NWListener(using: .tcp, on: .any)
        listener.newConnectionHandler = { [weak self] c in self?.serve(c) }
    }
    func start() async -> UInt16 {
        await withCheckedContinuation { cont in
            listener.stateUpdateHandler = { [listener] s in if case .ready = s { cont.resume(returning: listener.port!.rawValue); listener.stateUpdateHandler = nil } }
            listener.start(queue: .global())
        }
    }
    func stop() { listener.cancel() }
    private func send(_ c: NWConnection, _ s: String) { c.send(content: Data(s.utf8), completion: .contentProcessed { _ in }) }
    private var caps: String { "IMAP4rev1 AUTH=XOAUTH2" + (advertiseSASLIR ? " SASL-IR" : "") }
    private func serve(_ c: NWConnection) {
        c.start(queue: .global())
        send(c, "* OK [CAPABILITY \(caps)] stub ready\r\n")
        func read() {
            c.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [self] data, _, done, err in
                guard let data, let line = String(data: data, encoding: .utf8) else { c.cancel(); return }
                for l in line.split(separator: "\r\n") {
                    let w = l.split(separator: " ").map(String.init)
                    if let tag = pendingTag {  // continuation line carrying the credentials
                        pendingTag = nil
                        if let d = Data(base64Encoded: String(l)) { lock.lock(); sasl = String(data: d, encoding: .utf8); lock.unlock() }
                        send(c, "\(tag) OK [CAPABILITY IMAP4rev1] authenticated\r\n"); continue
                    }
                    guard w.count >= 2 else { continue }
                    switch w[1].uppercased() {
                    case "CAPABILITY": send(c, "* CAPABILITY \(caps)\r\n\(w[0]) OK done\r\n")
                    case "AUTHENTICATE":
                        if w.count >= 4, let d = Data(base64Encoded: w[3]) {
                            lock.lock(); sasl = String(data: d, encoding: .utf8); lock.unlock()
                            send(c, "\(w[0]) OK [CAPABILITY IMAP4rev1] authenticated\r\n")
                        } else { pendingTag = w[0]; send(c, "+ \r\n") }
                    case "LOGOUT": send(c, "* BYE\r\n\(w[0]) OK bye\r\n")
                    default: send(c, "\(w[0]) OK\r\n")
                    }
                }
                if done || err != nil { return }
                read()
            }
        }
        read()
    }
    var captured: String? { lock.lock(); defer { lock.unlock() }; return sasl }
}

func runXOAuthStub() async {
    for saslIR in [true, false] {
        await step("S2.11 XOAUTH2 SASL string via stub (SASL-IR \(saslIR ? "advertised" : "absent"))") {
            let stub = try StubIMAP(saslIR: saslIR)
            let port = await stub.start()
            defer { stub.stop() }
            let s = IMAPServer(host: "127.0.0.1", port: Int(port), transportSecurity: .plainText)
            try await s.connect()
            try await s.authenticateXOAUTH2(email: "me@example.com", accessToken: "tok123")
            try? await s.logout()
            let expected = "user=me@example.com\u{1}auth=Bearer tok123\u{1}\u{1}"
            guard stub.captured == expected else { throw IMAPError.commandFailed("SASL mismatch") }
            return "SASL string matches RFC XOAUTH2 form"
        }
    }
}
