// "Test connection" for the add-account form (track 2C). Port of `testConnection`/`checkConnection` in connect.ts and
// connectionCheck.ts: IMAP login, then SMTP verify, each reported on its own so the form can point at the server that
// failed. Messages follow DESIGN.md section 8 and never contain credentials.

import FlintModel
import Foundation

public enum ConnectionOutcome: Hashable, Sendable {
    case ok
    case failed(FlintError)
    /// Not attempted because an earlier step failed.
    case skipped
}

public struct ConnectionCheck: Hashable, Sendable {
    public var imap: ConnectionOutcome
    public var smtp: ConnectionOutcome

    public var isOK: Bool { imap == .ok && smtp == .ok }

    /// The first failure, for callers that show one message.
    public var firstError: FlintError? {
        for outcome in [imap, smtp] { if case .failed(let e) = outcome { return e } }
        return nil
    }
}

private let appPasswordHosts = try! NSRegularExpression(
    pattern: #"(^|\.)(gmail\.com|googlemail\.com|google\.com|me\.com|icloud\.com|yahoo\.com|aol\.com|office365\.com|outlook\.com)$"#, options: .caseInsensitive)

private func passwordAdvice(_ host: String) -> String {
    let range = NSRange(host.startIndex..., in: host)
    return appPasswordHosts.firstMatch(in: host, range: range) != nil ? " This provider needs an app password." : ""
}

/// Gmail answers "Lookup failed" when the Google account has no Gmail mailbox. That is not a wrong password.
public func isGmailLookupFailure(_ error: FlintError) -> Bool {
    error.message.range(of: "lookup failed", options: .caseInsensitive) != nil || error.message == noMailboxMessage("IMAP")
}

private func noMailboxMessage(_ what: String) -> String { "The \(what) server has no mailbox for this account." }

/// Short, user-facing text for a transport failure.
func describeConnectError(_ error: Error, what: String, host: String) -> FlintError {
    guard let e = error as? FlintError else { return FlintError(.network, "\(what) connection failed.") }
    let text = e.message
    switch e.code {
    case .auth:
        if isGmailLookupFailure(e) { return FlintError(.auth, noMailboxMessage(what)) }
        return FlintError(.auth, "The server rejected the username or password.\(passwordAdvice(host))")
    case .network:
        let transient = text.range(of: #"too many (simultaneous )?connections|temporar|try again|unavailable|overquota|rate limit"#, options: [.regularExpression, .caseInsensitive]) != nil
        if transient { return FlintError(.network, "The \(what) server is busy or temporarily unavailable. Flint will try again.") }
        if text.range(of: #"certificate|self.signed|CERT_|\bSSL\b|\bTLS\b"#, options: [.regularExpression, .caseInsensitive]) != nil {
            return FlintError(.network, "The \(what) server's security certificate was not accepted.")
        }
        return FlintError(.network, "Couldn't reach \(host). Check the server name or your connection.")
    default:
        return e
    }
}

/// Logs in over IMAP and verifies SMTP with a fresh transport. The transport is always disconnected afterwards.
public func testConnection(server: ServerConfig, credential: MailCredential, transport makeTransport: MailTransportFactory) async -> ConnectionCheck {
    let transport = makeTransport()
    do {
        try await transport.connect(MailTransportConfiguration(server: server, credential: credential))
    } catch {
        await transport.disconnect()
        return ConnectionCheck(imap: .failed(describeConnectError(error, what: "IMAP", host: server.imapHost)), smtp: .skipped)
    }
    do {
        try await transport.verifySend()
    } catch {
        await transport.disconnect()
        return ConnectionCheck(imap: .ok, smtp: .failed(describeConnectError(error, what: "SMTP", host: server.smtpHost)))
    }
    await transport.disconnect()
    return ConnectionCheck(imap: .ok, smtp: .ok)
}
