import FlintMail
import FlintModel
import Foundation
import Testing

private func deps(from input: JSONValue) -> AutoconfigDeps {
    let xml = input["ispdbXml"]?.stringValue
    let mx = input["mx"]
    let open = Set((input["open"]?.arrayValue ?? []).compactMap(\.stringValue))
    return AutoconfigDeps(
        fetch: { _ in
            guard let xml else { throw FlintError(.network, "ispdb down") }
            return HTTPResponse(status: 200, body: Data(xml.utf8))
        },
        resolveMX: { _ in
            if mx?.stringValue == "error" { throw FlintError(.network, "dns") }
            return (mx?.arrayValue ?? []).compactMap(\.stringValue).enumerated().map { MXRecord(exchange: $1, priority: ($0 + 1) * 10) }
        },
        probe: { host, port in open.contains("\(host):\(port)") },
        timeout: 2)
}

private func expectedConfig(_ e: JSONValue) -> (ServerConfig, ServerHint?, MailProvider, Bool)? {
    guard let imapHost = e["imapHost"]?.stringValue, let imapPort = e["imapPort"]?.intValue, let imapSecure = e["imapSecure"]?.boolValue,
          let smtpHost = e["smtpHost"]?.stringValue, let smtpPort = e["smtpPort"]?.intValue, let smtpSecure = e["smtpSecure"]?.boolValue,
          let username = e["username"]?.stringValue
    else { return nil }
    let server = ServerConfig(imapHost: imapHost, imapPort: imapPort, imapSecure: imapSecure, smtpHost: smtpHost, smtpPort: smtpPort, smtpSecure: smtpSecure, username: username)
    return (server, e["hint"]?.stringValue.flatMap(ServerHint.init(rawValue:)), MailProvider(rawValue: e["provider"]?.stringValue ?? "imap") ?? .imap, e["oauthGoogle"]?.boolValue ?? false)
}

@Suite("Auth autoconfig (shared providers.json)")
struct AuthAutoconfigFixtureTests {
    let file = try! AuthFixtures.load("providers")

    @Test func fixtureVersionIsKnown() { #expect(file.meta.version == 1) }

    @Test func autoconfigCases() async throws {
        let cases = file.cases.filter { $0.input["fn"]?.stringValue == "autoconfig" }
        #expect(cases.count >= 40)
        for c in cases {
            let email = try #require(c.input["email"]?.stringValue)
            let found = try await autoconfig(email: email, deps: deps(from: c.input))
            let (server, hint, provider, oauth) = try #require(expectedConfig(c.expect), "\(c.name)")
            #expect(found.server == server, "\(c.name)")
            #expect(found.hint == hint, "\(c.name)")
            #expect(found.provider == provider, "\(c.name)")
            #expect(found.oauthGoogle == oauth, "\(c.name)")
            #expect(found.source.rawValue == c.expect["source"]?.stringValue, "\(c.name)")
        }
    }

    @Test func parseIspdbCases() throws {
        let cases = file.cases.filter { $0.input["fn"]?.stringValue == "parseIspdb" }
        #expect(!cases.isEmpty)
        for c in cases {
            let parsed = parseIspdb(xml: try #require(c.input["xml"]?.stringValue), email: try #require(c.input["email"]?.stringValue))
            guard let expected = expectedConfig(c.expect.mergingUsername(parsed?.server.username)) else {
                #expect(parsed == nil, "\(c.name)")
                continue
            }
            #expect(parsed?.server == expected.0, "\(c.name)")
            #expect(parsed?.provider == expected.2, "\(c.name)")
        }
    }

    @Test func mxHostCases() async throws {
        let cases = file.cases.filter { $0.input["fn"]?.stringValue == "mxHost" }
        #expect(!cases.isEmpty)
        for c in cases {
            let input = c.input["exchanges"]
            let resolver: @Sendable (String) async throws -> [MXRecord] = { _ in
                if input?.stringValue == "error" { throw FlintError(.network, "dns") }
                return (input?.arrayValue ?? []).compactMap(\.stringValue).map { MXRecord(exchange: $0, priority: 10) }
            }
            let host = await mxHost(of: "corp.test", resolveMX: resolver)
            #expect(host?.rawValue == c.expect.stringValue, "\(c.name)")
        }
    }

    @Test func domainOfCases() throws {
        let cases = file.cases.filter { $0.input["fn"]?.stringValue == "domainOf" }
        #expect(!cases.isEmpty)
        for c in cases {
            let email = try #require(c.input["email"]?.stringValue)
            if let want = c.expect.stringValue {
                #expect(try domainOf(email) == want, "\(c.name)")
            } else {
                #expect(throws: FlintError.self, "\(c.name)") { try domainOf(email) }
                do { _ = try domainOf(email) } catch let e as FlintError { #expect(e.code == .invalid, "\(c.name)"); #expect(e.message == "Enter a full email address.") }
            }
        }
    }
}

private extension JSONValue {
    /// parseIspdb fixtures omit `username`; the parsed value supplies it so the comparison covers the other keys.
    func mergingUsername(_ username: String?) -> JSONValue {
        guard case .object(var o) = self, o["username"] == nil, let username else { return self }
        o["username"] = .string(username)
        return .object(o)
    }
}

@Suite("Auth autoconfig behavior")
struct AuthAutoconfigBehaviorTests {
    @Test func ispdbHangFallsThroughToMX() async throws {
        let d = AutoconfigDeps(
            fetch: { _ in try await Task.sleep(for: .seconds(30)); return HTTPResponse(status: 200, body: Data()) },
            resolveMX: { _ in [MXRecord(exchange: "mx1.messagingengine.com", priority: 10)] },
            probe: { _, _ in false },
            timeout: 0.1)
        let found = try await autoconfig(email: "a@corp.test", deps: d)
        #expect(found.source == .mx)
        #expect(found.server.imapHost == "imap.fastmail.com")
    }

    @Test func ispdbNon200FallsThrough() async throws {
        let d = AutoconfigDeps(
            fetch: { _ in HTTPResponse(status: 404, body: Data("<clientConfig/>".utf8)) },
            resolveMX: { _ in [] }, probe: { _, _ in false }, timeout: 1)
        #expect(try await autoconfig(email: "a@corp.test", deps: d).source == .guess)
    }

    @Test func ispdbRequestUsesDomainOnly() async throws {
        let seen = URLBox()
        let d = AutoconfigDeps(fetch: { url in await seen.set(url); return HTTPResponse(status: 404, body: Data()) }, resolveMX: { _ in [] }, probe: { _, _ in false }, timeout: 1)
        _ = try await autoconfig(email: "Kim.Private@Corp.Test", deps: d)
        let url = try #require(await seen.url)
        #expect(url.absoluteString == "https://autoconfig.thunderbird.net/v1.1/corp.test")
    }

    @Test func invalidEmailThrows() async {
        await #expect(throws: FlintError.self) { try await autoconfig(email: "nope", deps: .offline) }
    }

    @Test func resultConvertsToFlatAutoconfigResult() async throws {
        let found = try await autoconfig(email: "me@proton.me", deps: .offline)
        #expect(found.result.hint == .protonBridge)
        #expect(found.result.server.imapHost == "127.0.0.1")
    }

    @Test func iosAdviceForProtonAndMicrosoft() async throws {
        let proton = try await autoconfig(email: "me@proton.me", deps: .offline)
        #expect(proton.iosAdvice == .needsProtonBridge)
        #expect(proton.iosAdvice?.blocksSetup == true)
        #expect(proton.iosAdvice?.message == "Needs Proton Bridge on a computer")
        let outlook = try await autoconfig(email: "me@outlook.com", deps: .offline)
        #expect(outlook.iosAdvice == .microsoftSignInUnsupported)
        #expect(outlook.iosAdvice?.blocksSetup == false)
        #expect(outlook.iosAdvice?.message == "Microsoft sign-in isn't supported yet")
        let gmail = try await autoconfig(email: "me@gmail.com", deps: .offline)
        #expect(gmail.iosAdvice == nil)
    }
}

private actor URLBox {
    var url: URL?
    func set(_ u: URL) { url = u }
}

private extension AutoconfigDeps {
    static var offline: AutoconfigDeps {
        AutoconfigDeps(fetch: { _ in throw FlintError(.network, "offline") }, resolveMX: { _ in throw FlintError(.network, "offline") }, probe: { _, _ in false }, timeout: 1)
    }
}

@Suite("Auth MX record data")
struct AuthMXRecordTests {
    private func rdata(priority: UInt16, labels: [String]) -> Data {
        var d = Data([UInt8(priority >> 8), UInt8(priority & 0xFF)])
        for l in labels { d.append(UInt8(l.utf8.count)); d.append(contentsOf: l.utf8) }
        d.append(0)
        return d
    }

    @Test func parsesPriorityAndName() {
        let record = parseMXRecordData(rdata(priority: 10, labels: ["aspmx", "l", "google", "com"]))
        #expect(record == MXRecord(exchange: "aspmx.l.google.com", priority: 10))
    }

    @Test func rejectsTruncatedAndCompressedData() {
        #expect(parseMXRecordData(Data([0, 10])) == nil)
        #expect(parseMXRecordData(Data([0, 10, 5, 0x61])) == nil)
        #expect(parseMXRecordData(Data([0, 10, 0xC0, 0x0C])) == nil)
        #expect(parseMXRecordData(Data()) == nil)
    }

    @Test func rootExchangeIsNullMX() {
        #expect(parseMXRecordData(Data([0, 0, 0])) == MXRecord(exchange: "", priority: 0))
    }
}

/// Opt in with FLINT_NETWORK=1: uses the real system resolver and the network.
@Suite("Auth live network", .enabled(if: ProcessInfo.processInfo.environment["FLINT_NETWORK"] == "1"))
struct AuthLiveNetworkTests {
    @Test func systemResolverFindsGoogleMX() async throws {
        let records = try await resolveMXViaDNSService("gmail.com")
        #expect(!records.isEmpty)
        #expect(await mxHost(of: "gmail.com", resolveMX: { try await resolveMXViaDNSService($0) }) == .google)
    }

    @Test func missingDomainHasNoRecords() async throws {
        let records = try await resolveMXViaDNSService("no-such-domain-flint.invalid")
        #expect(records.isEmpty)
    }

    @Test func tcpProbeSeesGmailImapAndNothingOnClosedPort() async {
        #expect(await tcpProbe(host: "imap.gmail.com", port: 993))
        #expect(await tcpProbe(host: "127.0.0.1", port: 9, timeout: 1) == false)
    }
}
