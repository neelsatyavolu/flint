import FlintModel
import Foundation
import Testing
@testable import FlintPairing

actor FakeTarget: ImportTarget {
    var stored: [Account]
    var signatures: [Signature] = []
    var templates: [Template] = []
    var rules: [Rule] = []
    var blocked: [String] = []
    var settingsPatches: [JSONValue] = []
    var passwords: [String: String] = [:]
    var failLogin: Set<String> = []
    var failRules = false
    var googleCalls: [String?] = []
    var loginOK = true
    var loginThrows = false
    var loginChecks: [ServerConfig] = []
    private var nextId = 1

    init(accounts: [Account] = []) { stored = accounts }

    func failLogins(_ emails: Set<String>) { failLogin = emails }
    func failAllRules() { failRules = true }
    func setStoredLogin(works: Bool, throwing: Bool = false) { loginOK = works; loginThrows = throwing }

    func accounts() async throws -> [Account] { stored }

    func addAccount(_ input: AddAccountInput) async throws -> Account {
        if failLogin.contains(input.email) { throw FlintError(.auth, "no") }
        passwords[input.email] = input.password
        if let i = stored.firstIndex(where: { $0.email.lowercased() == input.email.lowercased() }) {
            // Like the real service: signing in again replaces the password and the server of the account that is there.
            if let server = input.server { stored[i].server = server }
            return stored[i]
        }
        let account = Account(id: "acc\(nextId)", email: input.email, name: input.name, provider: input.provider ?? .imap, authKind: .password, server: input.server!)
        nextId += 1
        stored.append(account)
        return account
    }

    func addGoogleAccount(loginHint: String?) async throws -> Account {
        googleCalls.append(loginHint)
        let account = Account(id: "acc\(nextId)", email: loginHint ?? "x", name: "G", provider: .gmail, authKind: .oauthGoogle, server: ServerConfig(imapHost: "imap.gmail.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.gmail.com", smtpPort: 465, smtpSecure: true, username: loginHint ?? "x"))
        nextId += 1
        stored.append(account)
        return account
    }

    func updateAccount(id: AccountID, _ patch: AccountPatch) async throws -> Account {
        guard let i = stored.firstIndex(where: { $0.id == id }) else { throw FlintError(.notFound, "no") }
        if let v = patch.name { stored[i].name = v }
        if let v = patch.aliases { stored[i].aliases = v }
        if let v = patch.showInUnified { stored[i].showInUnified = v }
        if let v = patch.sortOrder { stored[i].sortOrder = v }
        if let v = patch.color { stored[i].color = v }
        if let v = patch.server { stored[i].server = v }
        return stored[i]
    }

    func storedLoginWorks(id: AccountID, on server: ServerConfig) async throws -> Bool {
        loginChecks.append(server)
        if loginThrows { throw FlintError(.network, "down") }
        return loginOK
    }

    func saveSignature(_ signature: Signature) async throws { signatures.append(signature) }
    func saveTemplate(_ template: Template) async throws { templates.append(template) }
    func saveRule(_ rule: Rule) async throws { if failRules { throw FlintError(.invalid, "bad") }; rules.append(rule) }
    func blockSender(_ pattern: String) async throws { blocked.append(pattern) }
    func applySettings(patch: JSONValue) async throws { settingsPatches.append(patch) }
    func signatures() async throws -> [Signature] { signatures }
    func templates() async throws -> [Template] { templates }
    func rules() async throws -> [Rule] { rules }
    func blockedPatterns() async throws -> [String] { blocked }
}

func bundle() throws -> PairingBundle { try PairingBundle.decode(sampleBundleData()) }
func phoneAccount(_ email: String, id: String = "phone1", server: ServerConfig? = nil) -> Account {
    Account(id: id, email: email, name: "Mine", provider: .imap, authKind: .password,
            server: server ?? ServerConfig(imapHost: "old", imapPort: 993, imapSecure: true, smtpHost: "old", smtpPort: 465, smtpSecure: true, username: email), color: "#111111", aliases: ["keep@x.com"])
}

/// The phone's copy of the bundle's first account with `change` applied to the servers.
func phoneAccount(like mac: BundleAccount, id: String = "phone1", _ change: (inout ServerConfig) -> Void = { _ in }) -> Account {
    var server = mac.server
    change(&server)
    return phoneAccount(mac.email, id: id, server: server)
}

@Suite("Pairing import")
struct PairingImportTests {
    @Test func planSplitsNewFromExistingAndMarksCredentials() throws {
        let plan = ImportPlan.make(bundle: try bundle(), library: ImportLibrary(accounts: [phoneAccount("NEEL@example.com")]))
        #expect(plan.accounts.map(\.existsOnPhone) == [true, false])
        #expect(plan.accounts[0].credential == .needsPassword)
        #expect(plan.accounts[1].credential == .needsGoogleSignIn)
        #expect(plan.accountsNeedingCredentials.map(\.account.email) == ["neel@gmail.com"])
        #expect(plan.serverSwitches.count == 1 && plan.conflictingAccounts.isEmpty && plan.newAccounts.count == 1)
    }

    @Test func aPasswordAccountWithoutAPasswordNeedsOne() throws {
        var b = try bundle()
        b.accounts[0].password = nil
        let plan = ImportPlan.make(bundle: b, library: ImportLibrary())
        #expect(plan.accounts[0].credential == .needsPassword)
    }

    @Test func planDropsLibraryItemsTheIPhoneAlreadyHas() throws {
        let library = ImportLibrary(
            signatures: [Signature(id: 4, name: "work", html: "")], templates: [Template(id: 1, name: "THANKS", html: "")],
            rules: [Rule(id: 2, name: "receipts", conditions: [], actions: [])], blockedPatterns: ["SPAM.example"])
        let plan = ImportPlan.make(bundle: try bundle(), library: library)
        #expect(plan.signatures.isEmpty && plan.templates.isEmpty && plan.rules.isEmpty)
        #expect(plan.blockedSenders == ["bad@example.org"])
        #expect(plan.alreadyHere == ImportCounts(signatures: 1, templates: 1, rules: 1, blockedSenders: 1))
    }

    @Test func importsPasswordAccountsLibraryAndSettings() async throws {
        let target = FakeTarget()
        let importer = BundleImporter(target: target)
        let plan = ImportPlan.make(bundle: try bundle(), library: ImportLibrary())
        let result = await importer.apply(plan, ImportSelection())
        #expect(result.added == ImportCounts(accounts: 1, signatures: 1, templates: 1, rules: 1, blockedSenders: 2))
        #expect(await target.passwords["neel@example.com"] == "app-password-sample")
        let stored = await target.stored
        #expect(stored.count == 1)
        #expect(stored[0].aliases == ["n@example.com"] && stored[0].color == "#4C8DFF" && stored[0].sortOrder == 0)
        #expect(await target.signatures.first?.accountIds == ["acc1"])
        #expect(await target.rules.first?.accountId == nil)
        #expect(result.settingsApplied)
        #expect(await target.settingsPatches.count == 1)
        #expect(await target.googleCalls.isEmpty)
    }

    @Test func aGoogleRowNeverReachesAddAccountAndSignsInWithTheLoginHint() async throws {
        let target = FakeTarget()
        let importer = BundleImporter(target: target)
        let row = try bundle().accounts[1]
        let account = try await importer.signInGoogle(row)
        #expect(await target.googleCalls == ["neel@gmail.com"])
        #expect(await target.passwords.isEmpty)
        #expect(account.showInUnified == false && account.sortOrder == 1)
    }

    @Test func signaturesAndRulesForUnsetAccountsAreSkippedNotWidened() async throws {
        var b = try bundle()
        b.signatures[0].accountEmails = ["neel@gmail.com"]
        b.rules[0].accountEmail = "neel@gmail.com"
        let target = FakeTarget()
        let result = await BundleImporter(target: target).apply(ImportPlan.make(bundle: b, library: ImportLibrary()), ImportSelection())
        #expect(result.skippedNoAccount == 2)
        #expect(await target.signatures.isEmpty)
        #expect(await target.rules.isEmpty)
    }

    @Test func aSignatureKeepsOnlyTheAccountsThatExist() async throws {
        var b = try bundle()
        b.signatures[0].accountEmails = ["neel@example.com", "neel@gmail.com"]
        let target = FakeTarget()
        _ = await BundleImporter(target: target).apply(ImportPlan.make(bundle: b, library: ImportLibrary()), ImportSelection())
        #expect(await target.signatures.first?.accountIds == ["acc1"])
    }

    @Test func aFailedLoginIsReportedAndTheRestStillImports() async throws {
        let target = FakeTarget()
        await target.failLogins(["neel@example.com"])
        let result = await BundleImporter(target: target).apply(ImportPlan.make(bundle: try bundle(), library: ImportLibrary()), ImportSelection())
        #expect(result.failedAccounts == ["neel@example.com"])
        #expect(result.added.accounts == 0 && result.added.templates == 1)
    }

    @Test func aFailingRuleDoesNotStopTheOthers() async throws {
        let target = FakeTarget()
        await target.failAllRules()
        let result = await BundleImporter(target: target).apply(ImportPlan.make(bundle: try bundle(), library: ImportLibrary()), ImportSelection())
        #expect(result.failedItems == 1 && result.added.rules == 0 && result.added.templates == 1)
    }

    @Test func existingAccountsAreKeptUnlessTheMacsVersionIsChosen() async throws {
        let existing = phoneAccount(like: try bundle().accounts[0])
        let plan = ImportPlan.make(bundle: try bundle(), library: ImportLibrary(accounts: [existing]))

        let keep = FakeTarget(accounts: [existing])
        let kept = await BundleImporter(target: keep).apply(plan, ImportSelection())
        #expect(kept.replacedAccounts == 0)
        let keptAccount = await keep.stored[0]
        #expect(keptAccount.name == "Mine" && keptAccount.aliases == ["keep@x.com"])
        #expect(await keep.passwords.isEmpty)

        let replace = FakeTarget(accounts: [existing])
        let replaced = await BundleImporter(target: replace).apply(plan, ImportSelection(replaceAccounts: ["neel@example.com"]))
        #expect(replaced.replacedAccounts == 1)
        let account = await replace.stored[0]
        #expect(account.name == "Neel" && account.aliases == ["n@example.com"] && account.server.imapHost == "imap.example.com")
        #expect(await replace.passwords.isEmpty)
        #expect(await replace.loginChecks.isEmpty)
    }

    // MARK: The stored password only follows servers that were checked

    private func replaceOne(phone: Account, login: Bool = true, throwing: Bool = false) async throws -> (FakeTarget, ImportResult, ImportPlan) {
        let target = FakeTarget(accounts: [phone])
        await target.setStoredLogin(works: login, throwing: throwing)
        let plan = ImportPlan.make(bundle: try bundle(), library: ImportLibrary(accounts: [phone]))
        let result = await BundleImporter(target: target).apply(plan, ImportSelection(replaceAccounts: ["neel@example.com"]))
        return (target, result, plan)
    }

    @Test func planClassifiesServerChanges() throws {
        let mac = try bundle().accounts[0]
        func change(_ edit: (inout ServerConfig) -> Void) -> ServerChange {
            ImportPlan.make(bundle: (try? bundle())!, library: ImportLibrary(accounts: [phoneAccount(like: mac, edit)])).accounts[0].serverChange
        }
        #expect(change { _ in } == .none)
        #expect(change { $0.imapHost = mac.imap.host.uppercased() } == .detailsOnly)
        #expect(change { $0.imapPort = 143 } == .detailsOnly)
        #expect(change { $0.smtpSecure = false } == .detailsOnly)
        #expect(change { $0.username = "other@example.com" } == .detailsOnly)
        #expect(change { $0.imapHost = "imap.elsewhere.test" } == .hostChanged)
        #expect(change { $0.smtpHost = "smtp.elsewhere.test" } == .hostChanged)
    }

    @Test func aGoogleAccountOnThePhoneNeverCountsAsAServerChange() throws {
        let mac = try bundle().accounts[0]
        var google = phoneAccount(like: mac) { $0.imapHost = "imap.gmail.com" }
        google.authKind = .oauthGoogle
        let plan = ImportPlan.make(bundle: try bundle(), library: ImportLibrary(accounts: [google]))
        #expect(plan.accounts[0].serverChange == .none && plan.accounts[0].credential == .ready)
    }

    @Test func aHostChangeNeedsThePasswordAgainAndIsNotReplacedBySelection() async throws {
        let phone = phoneAccount("neel@example.com")
        let (target, result, plan) = try await replaceOne(phone: phone)
        #expect(plan.accounts[0].serverChange == .hostChanged && plan.accounts[0].credential == .needsPassword)
        #expect(result.replacedAccounts == 0)
        #expect(await target.loginChecks.isEmpty)
        #expect(await target.stored[0].server == phone.server)
        #expect(await target.stored[0].name == "Mine")
    }

    @Test func aChangedPortMovesOnlyAfterTheStoredLoginWorks() async throws {
        let mac = try bundle().accounts[0]
        let phone = phoneAccount(like: mac) { $0.imapPort = 143 }
        let (target, result, _) = try await replaceOne(phone: phone)
        #expect(await target.loginChecks == [mac.server])
        #expect(result.replacedAccounts == 1 && result.keptServers.isEmpty)
        #expect(await target.stored[0].server == mac.server)
    }

    @Test func aFailedLoginCheckKeepsTheStoredServersButStillTakesTheDetails() async throws {
        let mac = try bundle().accounts[0]
        for throwing in [false, true] {
            let phone = phoneAccount(like: mac) { $0.smtpPort = 587 }
            let (target, result, _) = try await replaceOne(phone: phone, login: false, throwing: throwing)
            #expect(await target.stored[0].server == phone.server)
            #expect(await target.stored[0].name == "Neel")
            #expect(result.replacedAccounts == 1 && result.keptServers == ["neel@example.com"])
        }
    }

    @Test func switchingServersWithATypedPasswordGoesThroughAddAccount() async throws {
        let phone = phoneAccount("neel@example.com")
        let target = FakeTarget(accounts: [phone])
        let mac = try bundle().accounts[0]
        let account = try await BundleImporter(target: target).switchServers(mac, password: "typed")
        #expect(await target.passwords["neel@example.com"] == "typed")
        #expect(account.server == mac.server && account.id == phone.id)
        #expect(await target.stored.count == 1)
    }

    @Test func aWrongTypedPasswordChangesNothing() async throws {
        let phone = phoneAccount("neel@example.com")
        let target = FakeTarget(accounts: [phone])
        await target.failLogins(["neel@example.com"])
        await #expect(throws: FlintError.self) { _ = try await BundleImporter(target: target).switchServers(try bundle().accounts[0], password: "nope") }
        #expect(await target.stored[0].server == phone.server)
    }

    @Test func receiptsHostOnlyForHttpsEndpoints() throws {
        var settings = try bundle().settings
        #expect(settings.receiptsHost == "receipts.example.com")
        settings.receipts?.endpoint = "http://receipts.example.com"
        #expect(settings.receiptsHost == nil)
        settings.receipts?.endpoint = nil
        #expect(settings.receiptsHost == nil)
        settings.receipts?.endpoint = "ftp://x.example.com"
        #expect(settings.receiptsHost == nil)
    }

    @Test func leavingTheLibraryAndSettingsOutImportsOnlyAccounts() async throws {
        let target = FakeTarget()
        let result = await BundleImporter(target: target).apply(ImportPlan.make(bundle: try bundle(), library: ImportLibrary()), ImportSelection(includeLibrary: false, includeSettings: false))
        #expect(result.added == ImportCounts(accounts: 1))
        #expect(await target.signatures.isEmpty)
        #expect(await target.settingsPatches.isEmpty)
        #expect(!result.settingsApplied)
    }

    @Test func anEmptyBundleChangesNothing() async throws {
        let c = try PairingFixtures.cases("pairing-bundle").first { $0.name == "empty bundle" }!
        let b = try PairingBundle.decode(JSONEncoder().encode(c.input))
        let target = FakeTarget()
        let plan = ImportPlan.make(bundle: b, library: ImportLibrary())
        #expect(!plan.hasSettings)
        let result = await BundleImporter(target: target).apply(plan, ImportSelection())
        #expect(result == ImportResult())
    }
}
