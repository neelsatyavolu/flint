// Server settings for an email address (track 2C). Port of `autoconfig` in packages/core/src/mail/autoconfig.ts:
// known table, then Mozilla ISPDB, then MX records, then guessed host names. Network access is injected.
// Privacy: the ISPDB request names only the domain; MX lookups go to the system resolver (no DoH provider).

import FlintModel
import Foundation

public enum AutoconfigSource: String, Hashable, Sendable {
    case known, ispdb, mx, guess
}

public struct Autoconfig: Hashable, Sendable {
    public var server: ServerConfig
    /// What the form should say about the password.
    public var hint: ServerHint?
    public var provider: MailProvider
    public var source: AutoconfigSource
    /// Google sign-in (XOAUTH2) is available for this address.
    public var oauthGoogle: Bool

    /// The flat shape the UI and settings export use.
    public var result: AutoconfigResult { AutoconfigResult(server: server, hint: hint) }

    /// iPhone-specific limits on top of the detected settings (DESIGN-NOTES section 6).
    public var iosAdvice: ProviderAdvice? {
        if hint == .protonBridge { return .needsProtonBridge }
        if server.imapHost == ProviderPresets.outlook.imapHost { return .microsoftSignInUnsupported }
        return nil
    }
}

public enum ProviderAdvice: Hashable, Sendable {
    case needsProtonBridge
    case microsoftSignInUnsupported

    /// Proton cannot work on a phone at all; Microsoft may still work with an app password, so the form only warns.
    public var blocksSetup: Bool { self == .needsProtonBridge }

    public var message: String {
        switch self {
        case .needsProtonBridge: return "Needs Proton Bridge on a computer"
        case .microsoftSignInUnsupported: return "Microsoft sign-in isn't supported yet"
        }
    }
}

public struct AutoconfigDeps: Sendable {
    public var fetch: @Sendable (URL) async throws -> HTTPResponse
    public var resolveMX: @Sendable (String) async throws -> [MXRecord]
    /// True when something accepts TCP connections on host:port. Used to choose between guesses.
    public var probe: @Sendable (String, Int) async -> Bool
    /// Seconds allowed for the ISPDB request.
    public var timeout: TimeInterval

    public init(
        fetch: @escaping @Sendable (URL) async throws -> HTTPResponse,
        resolveMX: @escaping @Sendable (String) async throws -> [MXRecord],
        probe: @escaping @Sendable (String, Int) async -> Bool,
        timeout: TimeInterval = 5
    ) {
        self.fetch = fetch
        self.resolveMX = resolveMX
        self.probe = probe
        self.timeout = timeout
    }

    public static var live: AutoconfigDeps {
        AutoconfigDeps(fetch: { try await HTTPClient.live.get($0) }, resolveMX: { try await resolveMXViaDNSService($0) }, probe: { await tcpProbe(host: $0, port: $1) })
    }
}

/// The domain part of an address, lower-cased. Throws `.invalid` for anything that is not `name@domain`.
public func domainOf(_ email: String) throws -> String {
    guard let at = email.lastIndex(of: "@"), at != email.startIndex, email.index(after: at) != email.endIndex else {
        throw FlintError(.invalid, "Enter a full email address.")
    }
    return email[email.index(after: at)...].trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
}

func withTimeout<T: Sendable>(_ seconds: TimeInterval, _ operation: @escaping @Sendable () async throws -> T) async throws -> T {
    try await withThrowingTaskGroup(of: T.self) { group in
        group.addTask { try await operation() }
        group.addTask {
            try await Task.sleep(for: .seconds(seconds))
            throw FlintError(.network, "Timed out.")
        }
        defer { group.cancelAll() }
        guard let first = try await group.next() else { throw FlintError(.network, "Timed out.") }
        return first
    }
}

private func fetchIspdb(domain: String, email: String, deps: AutoconfigDeps) async -> IspdbConfig? {
    guard let encoded = domain.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
          let url = URL(string: "https://autoconfig.thunderbird.net/v1.1/\(encoded)")
    else { return nil }
    let fetch = deps.fetch
    guard let response = try? await withTimeout(deps.timeout, { try await fetch(url) }), (200..<300).contains(response.status) else { return nil }
    return parseIspdb(xml: String(decoding: response.body, as: UTF8.self), email: email)
}

private func guessServers(domain: String, address: String, probe: @Sendable (String, Int) async -> Bool) async -> Autoconfig {
    var imapHost = "imap.\(domain)"
    for host in ["imap.\(domain)", "mail.\(domain)"] where await probe(host, 993) {
        imapHost = host
        break
    }
    let smtpCandidates: [(String, Int, Bool)] = [("smtp.\(domain)", 465, true), ("smtp.\(domain)", 587, false), ("mail.\(domain)", 465, true), ("mail.\(domain)", 587, false)]
    var smtp = smtpCandidates[0]
    for candidate in smtpCandidates where await probe(candidate.0, candidate.1) {
        smtp = candidate
        break
    }
    let server = ServerConfig(imapHost: imapHost, imapPort: 993, imapSecure: true, smtpHost: smtp.0, smtpPort: smtp.1, smtpSecure: smtp.2, username: address)
    return Autoconfig(server: server, hint: nil, provider: .imap, source: .guess, oauthGoogle: false)
}

/// Server settings for an address: known table, then ISPDB, then MX, then guessed host names.
public func autoconfig(email: String, deps: AutoconfigDeps) async throws -> Autoconfig {
    let address = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    let domain = try domainOf(address)
    if let known = ProviderPresets.known[domain] { return known.autoconfig(username: address, source: .known) }
    if let ispdb = await fetchIspdb(domain: domain, email: address, deps: deps) {
        return Autoconfig(server: ispdb.server, hint: nil, provider: ispdb.provider, source: .ispdb, oauthGoogle: false)
    }
    if let host = await mxHost(of: domain, resolveMX: deps.resolveMX) {
        return ProviderPresets.byMX(host).autoconfig(username: address, source: .mx)
    }
    return await guessServers(domain: domain, address: address, probe: deps.probe)
}
