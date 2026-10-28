import FlintMail
import FlintModel
import Foundation
import Testing

private let tokenURL = "https://oauth2.googleapis.com/token"
private let now = Date(timeIntervalSince1970: 1_800_000_000)
private let server = ServerConfig(imapHost: "imap.example.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.example.com", smtpPort: 465, smtpSecure: true, username: "me@example.com")

private func b64url(_ s: String) -> String {
    Data(s.utf8).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
}

private struct Rig {
    let accounts = MemoryAccounts()
    let secrets = InMemorySecretStore()
    let lifecycle = RecordingLifecycle()
    let http = ScriptedHTTP()
    let transport = FakeMailTransport()
    let browser = ScriptedBrowser()
    var mx: [MXRecord] = []

    var service: AccountService {
        let mx = self.mx
        let transport = self.transport
        return AccountService(
            accounts: accounts, secrets: secrets, lifecycle: lifecycle,
            transport: { transport },
            oauth: GoogleOAuthClient(config: GoogleOAuthConfig(clientId: "123-abc.apps.googleusercontent.com"), http: http.client, now: { now }),
            autoconfigDeps: AutoconfigDeps(
                fetch: { _ in throw FlintError(.network, "offline") }, resolveMX: { _ in mx }, probe: { _, _ in false }, timeout: 1),
            browser: browser, now: { now })
    }
}

actor ScriptedBrowser: OAuthBrowser {
    private(set) var opened: [(url: URL, scheme: String)] = []
    private var behavior: (URL) throws -> URL = { _ in throw FlintError(.auth, "unscripted") }

    func respond(_ f: @escaping @Sendable (URL) throws -> URL) { behavior = f }

    func authenticate(url: URL, callbackScheme: String) async throws -> URL {
        opened.append((url, callbackScheme))
        return try behavior(url)
    }
}

private func stateOf(_ url: URL) -> String {
    URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "state" }?.value ?? ""
}

private func googleTokens(email: String = "me@gmail.com") -> String {
    let id = "\(b64url("{}")).\(b64url("{\"email\":\"\(email)\",\"name\":\"Me\"}")).sig"
    return #"{"access_token":"at","refresh_token":"rt","expires_in":3600,"id_token":"\#(id)"}"#
}

@Suite("Auth account service: password accounts")
struct AuthAddAccountTests {
    @Test func addsAnAccountWithExplicitServerAndStoresThePassword() async throws {
        let rig = Rig()
        let account = try await rig.service.addAccount(AddAccountInput(email: " Me@Example.com ", name: " Me ", password: "pw", server: server))
        #expect(account.email == "me@example.com")
        #expect(account.name == "Me")
        #expect(account.authKind == .password)
        #expect(account.provider == .imap)
        #expect(account.server == server)
        #expect(try await rig.secrets.readAccountSecret(account.id) == .password("pw"))
        #expect(await rig.lifecycle.events == ["restart:\(account.id)", "changed:\(account.id)"])
        #expect(await rig.transport.calls == ["connect", "verifySend", "disconnect"])
    }

    @Test func autoconfigFillsTheServerWhenNoneIsGiven() async throws {
        let rig = Rig()
        let account = try await rig.service.addAccount(AddAccountInput(email: "me@icloud.com", name: "Me", password: "pw"))
        #expect(account.server.imapHost == "imap.mail.me.com")
        #expect(account.server.username == "me@icloud.com")
    }

    @Test func gmailAppPasswordsLoseTheirSpaces() async throws {
        let rig = Rig()
        let account = try await rig.service.addAccount(AddAccountInput(email: "me@gmail.com", name: "Me", password: "abcd efgh ijkl mnop"))
        #expect(account.provider == .gmail)
        #expect(account.authKind == .password)
        #expect(try await rig.secrets.readAccountSecret(account.id) == .password("abcdefghijklmnop"))
        guard case .password(_, let sent)? = await rig.transport.configuration?.credential else { Issue.record("no credential"); return }
        #expect(sent == "abcdefghijklmnop")
    }

    @Test func imapFailureStoresNothing() async throws {
        let rig = Rig()
        await rig.transport.rejectLogins()
        await expectAuthError("The server rejected the username or password.") {
            _ = try await rig.service.addAccount(AddAccountInput(email: "me@example.com", name: "Me", password: "pw", server: server))
        }
        #expect(await rig.accounts.rows.isEmpty)
        #expect(try await rig.secrets.get("account:gen1") == nil)
        #expect(await rig.lifecycle.events.isEmpty)
    }

    @Test func smtpFailureStoresNothing() async throws {
        let rig = Rig()
        await rig.transport.failNext("verifySend", with: FlintError(.network, "x"))
        await expectAuthError("Couldn't reach smtp.example.com. Check the server name or your connection.", code: .network) {
            _ = try await rig.service.addAccount(AddAccountInput(email: "me@example.com", name: "Me", password: "pw", server: server))
        }
        #expect(await rig.accounts.rows.isEmpty)
    }

    @Test func existingGoogleAccountSwitchesToPasswordInPlace() async throws {
        let rig = Rig()
        let gmailServer = ServerConfig(imapHost: "imap.gmail.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.gmail.com", smtpPort: 465, smtpSecure: true, username: "me@gmail.com")
        await rig.accounts.seed(Account(id: "old1", email: "me@gmail.com", name: "Kept", provider: .gmail, authKind: .oauthGoogle, server: gmailServer, enabled: false))
        try await rig.secrets.writeAccountSecret("old1", .oauth(accessToken: "a", refreshToken: "r", expiresAt: 0))
        let account = try await rig.service.addAccount(AddAccountInput(email: "me@gmail.com", name: "", password: "abcd efgh", server: server))
        #expect(account.id == "old1")
        #expect(account.authKind == .password)
        #expect(account.provider == .imap)
        #expect(account.server == server)
        #expect(account.name == "Kept")
        #expect(account.enabled)
        #expect(await rig.accounts.rows.count == 1)
        #expect(try await rig.secrets.readAccountSecret("old1") == .password("abcd efgh"))
    }

    @Test func existingImapAccountChangingProviderIsUpdatedInPlace() async throws {
        let rig = Rig()
        await rig.accounts.seed(Account(id: "old1", email: "me@gmail.com", name: "Kept", provider: .imap, authKind: .password, server: server))
        let account = try await rig.service.addAccount(AddAccountInput(email: "me@gmail.com", name: "", password: "pw", provider: .gmail, server: server))
        #expect(account.id == "old1")
        #expect(account.provider == .gmail)
        #expect(await rig.accounts.rows.count == 1)
    }

    @Test func signingInAgainReplacesCredentialsOnTheSameAccount() async throws {
        let rig = Rig()
        let first = try await rig.service.addAccount(AddAccountInput(email: "me@example.com", name: "Me", password: "old", server: server))
        var moved = server
        moved.imapHost = "imap2.example.com"
        let second = try await rig.service.addAccount(AddAccountInput(email: "ME@example.com", name: "Other", password: "new", server: moved))
        #expect(second.id == first.id)
        #expect(second.server.imapHost == "imap2.example.com")
        #expect(second.name == "Me")
        #expect(second.enabled)
        #expect(await rig.accounts.rows.count == 1)
        #expect(try await rig.secrets.readAccountSecret(first.id) == .password("new"))
    }

    @Test func validatesInputBeforeAnyNetwork() async {
        let rig = Rig()
        for (input, message) in [
            (AddAccountInput(email: "nope", name: "", password: "pw", server: server), "Enter a full email address."),
            (AddAccountInput(email: "a@b", name: "", password: "pw", server: server), "Enter a full email address."),
            (AddAccountInput(email: "me@example.com", name: "", password: "", server: server), "Enter the password."),
            (AddAccountInput(email: "me@example.com", name: String(repeating: "n", count: 201), password: "pw", server: server), "That name is too long."),
            (AddAccountInput(email: "me@example.com", name: "", password: "pw", server: ServerConfig(imapHost: " ", imapPort: 993, imapSecure: true, smtpHost: "s", smtpPort: 465, smtpSecure: true, username: "u")), "Enter the server settings."),
            (AddAccountInput(email: "me@example.com", name: "", password: "pw", server: ServerConfig(imapHost: "i", imapPort: 0, imapSecure: true, smtpHost: "s", smtpPort: 465, smtpSecure: true, username: "u")), "Enter the server settings."),
            (AddAccountInput(email: "me@example.com", name: "", password: "pw", server: ServerConfig(imapHost: "i", imapPort: 993, imapSecure: true, smtpHost: "s", smtpPort: 70000, smtpSecure: true, username: "u")), "Enter the server settings."),
        ] {
            await expectAuthError(message, code: .invalid) { _ = try await rig.service.addAccount(input) }
        }
        #expect(await rig.transport.calls.isEmpty)
    }

    @Test func testConnectionDoesNotSaveAnything() async throws {
        let rig = Rig()
        let result = try await rig.service.testConnection(AddAccountInput(email: "me@example.com", name: "", password: "pw", server: server))
        #expect(result.isOK)
        #expect(await rig.accounts.rows.isEmpty)
        #expect(await rig.lifecycle.events.isEmpty)
    }

    @Test func autoconfigReturnsFlatResultOrNil() async throws {
        let rig = Rig()
        let found = try await rig.service.autoconfig("me@proton.me")
        #expect(found?.hint == .protonBridge)
        #expect(try await rig.service.autoconfig("garbage") == nil)
    }
}

@Suite("Auth account service: Google accounts")
struct AuthGoogleAccountTests {
    private func signInRig(email: String = "me@gmail.com") async -> Rig {
        let rig = Rig()
        await rig.browser.respond { url in
            URL(string: "com.googleusercontent.apps.123-abc:/oauth2redirect?code=CODE&state=\(stateOf(url))")!
        }
        await rig.http.enqueue(tokenURL, status: 200, json: googleTokens(email: email))
        return rig
    }

    @Test func signsInChecksTheMailboxAndSavesTokens() async throws {
        let rig = await signInRig()
        let account = try await rig.service.addGoogleAccount(loginHint: nil)
        #expect(account.email == "me@gmail.com")
        #expect(account.name == "Me")
        #expect(account.provider == .gmail)
        #expect(account.authKind == .oauthGoogle)
        #expect(account.server.imapHost == "imap.gmail.com")
        #expect(account.server.smtpPort == 465)
        #expect(account.server.username == "me@gmail.com")
        #expect(try await rig.secrets.readAccountSecret(account.id) == .oauth(accessToken: "at", refreshToken: "rt", expiresAt: Int(now.timeIntervalSince1970 * 1000) + 3_600_000))
        guard case .xoauth2(let user, let token)? = await rig.transport.configuration?.credential else { Issue.record("not XOAUTH2"); return }
        #expect(user == "me@gmail.com" && token == "at")
        #expect(await rig.lifecycle.events == ["restart:\(account.id)", "changed:\(account.id)"])
        let opened = try #require(await rig.browser.opened.first)
        #expect(opened.scheme == "com.googleusercontent.apps.123-abc")
    }

    @Test func loginHintReachesTheBrowser() async throws {
        let rig = await signInRig()
        _ = try await rig.service.addGoogleAccount(loginHint: "me@gmail.com")
        let url = try #require(await rig.browser.opened.first?.url)
        #expect(url.absoluteString.contains("login_hint=me@gmail.com") || url.absoluteString.contains("login_hint=me%40gmail.com"))
    }

    @Test func cancellationLeavesNothingBehind() async {
        let rig = Rig()
        await rig.browser.respond { url in
            URL(string: "com.googleusercontent.apps.123-abc:/oauth2redirect?error=access_denied&state=\(stateOf(url))")!
        }
        do { _ = try await rig.service.addGoogleAccount(loginHint: nil); Issue.record("should throw") }
        catch let e as FlintError { #expect(e.isGoogleSignInCancelled) } catch { Issue.record("wrong error") }
        #expect(await rig.accounts.rows.isEmpty)
        #expect(await rig.http.requests.isEmpty)
    }

    @Test func browserSideCancellationIsRecognized() async {
        let rig = Rig()
        await rig.browser.respond { _ in throw FlintError.googleSignInCancelled }
        do { _ = try await rig.service.addGoogleAccount(loginHint: nil); Issue.record("should throw") }
        catch let e as FlintError { #expect(e.isGoogleSignInCancelled) } catch { Issue.record("wrong error") }
    }

    @Test func accountWithoutGmailNamesTheOtherHost() async throws {
        var rig = await signInRig(email: "me@corp.test")
        rig.mx = [MXRecord(exchange: "in1-smtp.messagingengine.com", priority: 10)]
        await rig.transport.failNext("connect", with: FlintError(.auth, "NO [AUTHENTICATIONFAILED] Lookup failed"))
        await expectAuthError("This Google account doesn't have a Gmail inbox. Its mail is handled by Fastmail.", code: .invalid) {
            _ = try await rig.service.addGoogleAccount(loginHint: nil)
        }
        #expect(await rig.accounts.rows.isEmpty)
        #expect(try await rig.secrets.get("account:gen1") == nil)
    }

    @Test func accountWithoutGmailAndUnknownHost() async throws {
        let rig = await signInRig(email: "me@corp.test")
        await rig.transport.failNext("connect", with: FlintError(.auth, "Lookup failed"))
        await expectAuthError("This Google account doesn't have a Gmail inbox. Its mail is handled by another provider.", code: .invalid) {
            _ = try await rig.service.addGoogleAccount(loginHint: nil)
        }
    }

    @Test func existingGoogleAccountKeepsItsIdAndGetsNewTokens() async throws {
        let rig = await signInRig()
        let gmail = ServerConfig(imapHost: "imap.gmail.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.gmail.com", smtpPort: 465, smtpSecure: true, username: "me@gmail.com")
        await rig.accounts.seed(Account(id: "old1", email: "me@gmail.com", name: "Kept", provider: .gmail, authKind: .oauthGoogle, server: gmail, enabled: false))
        try await rig.secrets.writeAccountSecret("old1", .oauth(accessToken: "stale", refreshToken: "dead", expiresAt: 0))
        let account = try await rig.service.addGoogleAccount(loginHint: nil)
        #expect(account.id == "old1")
        #expect(account.enabled)
        #expect(account.name == "Kept")
        #expect(await rig.accounts.rows.count == 1)
        #expect(try await rig.secrets.readAccountSecret("old1") == .oauth(accessToken: "at", refreshToken: "rt", expiresAt: Int(now.timeIntervalSince1970 * 1000) + 3_600_000))
    }

    @Test func existingPasswordAccountSwitchesToGoogleInPlace() async throws {
        let rig = await signInRig()
        await rig.accounts.seed(Account(id: "old1", email: "me@gmail.com", name: "Kept", provider: .imap, authKind: .password, server: server))
        try await rig.secrets.writeAccountSecret("old1", .password("app-password"))
        let account = try await rig.service.addGoogleAccount(loginHint: nil)
        #expect(account.id == "old1")
        #expect(account.authKind == .oauthGoogle)
        #expect(account.provider == .gmail)
        #expect(account.server.imapHost == "imap.gmail.com")
        #expect(await rig.accounts.rows.count == 1)
        #expect(try await rig.secrets.readAccountSecret("old1") == .oauth(accessToken: "at", refreshToken: "rt", expiresAt: Int(now.timeIntervalSince1970 * 1000) + 3_600_000))
    }

    @Test func tokenFailureStoresNothing() async {
        let rig = Rig()
        await rig.browser.respond { url in URL(string: "com.googleusercontent.apps.123-abc:/oauth2redirect?code=C&state=\(stateOf(url))")! }
        await rig.http.enqueue(tokenURL, status: 400, json: #"{"error":"invalid_grant"}"#)
        await expectAuthError("Google sign-in expired. Sign in again.") { _ = try await rig.service.addGoogleAccount(loginHint: nil) }
        #expect(await rig.accounts.rows.isEmpty)
    }
}

@Suite("Auth account service: edit and remove")
struct AuthEditAccountTests {
    private func seeded() async throws -> (Rig, Account) {
        let rig = Rig()
        let account = try await rig.service.addAccount(AddAccountInput(email: "me@example.com", name: "Me", password: "pw", server: server))
        return (rig, account)
    }

    @Test func updatesAllowedFieldsWithTrimmingAndLowercasing() async throws {
        let (rig, account) = try await seeded()
        let updated = try await rig.service.updateAccount(account.id, AccountPatch(name: "  New  ", color: .some("#4C8DFF"), aliases: [" Alias@Example.com "], showInUnified: false))
        #expect(updated.name == "New")
        #expect(updated.color == "#4C8DFF")
        #expect(updated.aliases == ["alias@example.com"])
        #expect(updated.showInUnified == false)
        #expect(await rig.lifecycle.events.last == "changed:\(account.id)")
    }

    @Test func togglingEnabledRestartsSync() async throws {
        let (rig, account) = try await seeded()
        _ = try await rig.service.updateAccount(account.id, AccountPatch(enabled: false))
        let events = await rig.lifecycle.events
        #expect(events.suffix(2) == ["restart:\(account.id)", "changed:\(account.id)"])
    }

    @Test func unchangedEnabledDoesNotRestart() async throws {
        let (rig, account) = try await seeded()
        let before = await rig.lifecycle.events.count
        _ = try await rig.service.updateAccount(account.id, AccountPatch(enabled: true))
        let after = await rig.lifecycle.events
        #expect(after.count == before + 1)
        #expect(after.last == "changed:\(account.id)")
    }

    @Test func rejectsBadValues() async throws {
        let (rig, account) = try await seeded()
        await expectAuthError("Enter a full email address.", code: .invalid) { _ = try await rig.service.updateAccount(account.id, AccountPatch(aliases: ["nope"])) }
        await expectAuthError("That name is too long.", code: .invalid) { _ = try await rig.service.updateAccount(account.id, AccountPatch(name: String(repeating: "n", count: 201))) }
        await expectAuthError("That color is not valid.", code: .invalid) { _ = try await rig.service.updateAccount(account.id, AccountPatch(color: .some(String(repeating: "c", count: 41)))) }
        await expectAuthError("Use no more than 50 aliases.", code: .invalid) {
            _ = try await rig.service.updateAccount(account.id, AccountPatch(aliases: (0..<51).map { "a\($0)@example.com" }))
        }
    }

    @Test func serverAndAddressChangesGoThroughSigningInAgain() async throws {
        let (rig, account) = try await seeded()
        await expectAuthError("Sign in again to change the address or server.", code: .invalid) { _ = try await rig.service.updateAccount(account.id, AccountPatch(server: server)) }
        await expectAuthError("Sign in again to change the address or server.", code: .invalid) { _ = try await rig.service.updateAccount(account.id, AccountPatch(email: "x@example.com")) }
        await expectAuthError("Sign in again to change the address or server.", code: .invalid) { _ = try await rig.service.updateAccount(account.id, AccountPatch(authKind: .oauthGoogle)) }
        await expectAuthError("Sign in again to change the address or server.", code: .invalid) { _ = try await rig.service.updateAccount(account.id, AccountPatch(provider: .gmail)) }
    }

    @Test func unknownAccountIsNotFound() async {
        let rig = Rig()
        await expectAuthError("No such account.", code: .notFound) { _ = try await rig.service.updateAccount("nope", AccountPatch(name: "x")) }
        await expectAuthError("No such account.", code: .notFound) { try await rig.service.removeAccount("nope") }
    }

    @Test func removeForgetsSyncDeletesSecretThenRows() async throws {
        let (rig, account) = try await seeded()
        try await rig.service.removeAccount(account.id)
        #expect(await rig.accounts.rows.isEmpty)
        #expect(try await rig.secrets.get("account:\(account.id)") == nil)
        let events = await rig.lifecycle.events
        #expect(events.suffix(2) == ["forget:\(account.id)", "changed:\(account.id)"])
    }
}
