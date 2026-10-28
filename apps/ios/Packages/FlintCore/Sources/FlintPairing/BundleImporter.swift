// Applies an `ImportPlan` through an `ImportTarget` (the app adapts `FlintService` to it). Order: accounts, then the
// library items that attach to them, then settings. A failing item is counted, never fatal, so one bad rule cannot
// lose the rest. Secrets go only into `addAccount`, which stores them in the Keychain.

import FlintModel
import Foundation

public protocol ImportTarget: Sendable {
    func accounts() async throws -> [Account]
    func addAccount(_ input: AddAccountInput) async throws -> Account
    func addGoogleAccount(loginHint: String?) async throws -> Account
    func updateAccount(id: AccountID, _ patch: AccountPatch) async throws -> Account
    /// True when the password stored for this account logs in to `server` (IMAP and SMTP). Nothing is saved or sent anywhere else.
    func storedLoginWorks(id: AccountID, on server: ServerConfig) async throws -> Bool
    func saveSignature(_ signature: Signature) async throws
    func saveTemplate(_ template: Template) async throws
    func saveRule(_ rule: Rule) async throws
    func blockSender(_ pattern: String) async throws
    func applySettings(patch: JSONValue) async throws
    /// What this iPhone already has, so a second pairing merges instead of duplicating.
    func signatures() async throws -> [Signature]
    func templates() async throws -> [Template]
    func rules() async throws -> [Rule]
    func blockedPatterns() async throws -> [String]
}

public struct ImportResult: Equatable, Sendable {
    public var added = ImportCounts()
    /// Accounts already on the iPhone whose details were replaced.
    public var replacedAccounts = 0
    /// Accounts whose login did not work with the password from the Mac. They stay on the review list.
    public var failedAccounts: [String] = []
    /// Accounts that took the Mac's name, color and aliases but keep the servers stored here, because the stored password
    /// did not log in to the Mac's servers.
    public var keptServers: [String] = []
    /// Signatures and rules that belong to an account that is not set up on this iPhone.
    public var skippedNoAccount = 0
    public var failedItems = 0
    public var settingsApplied = false
}

public struct BundleImporter: Sendable {
    private let target: any ImportTarget

    public init(target: any ImportTarget) { self.target = target }

    public func library() async throws -> ImportLibrary {
        async let accounts = target.accounts()
        async let signatures = target.signatures()
        async let templates = target.templates()
        async let rules = target.rules()
        async let blocked = target.blockedPatterns()
        return try await ImportLibrary(accounts: accounts, signatures: signatures, templates: templates, rules: rules, blockedPatterns: Set(blocked))
    }

    /// Adds one account now (the review row's "Add password", or an account the Mac sent a password for).
    public func addPasswordAccount(_ a: BundleAccount, password: String) async throws -> Account {
        let created = try await target.addAccount(AddAccountInput(email: a.email, name: a.name, password: password, provider: a.provider, server: a.server))
        return try await applyDetails(a, to: created.id)
    }

    /// "Use the Mac's servers" for an account whose hosts differ: the person typed the password again. It is checked against the
    /// Mac's servers before anything is saved, so a wrong password or an unreachable host changes nothing.
    public func switchServers(_ a: BundleAccount, password: String) async throws -> Account {
        try await addPasswordAccount(a, password: password)
    }

    /// Runs Google sign-in for a "Sign in" row, then restores the Mac's details for that account.
    public func signInGoogle(_ a: BundleAccount) async throws -> Account {
        let created = try await target.addGoogleAccount(loginHint: a.email)
        return try await applyDetails(a, to: created.id)
    }

    public func apply(_ plan: ImportPlan, _ selection: ImportSelection) async -> ImportResult {
        var result = ImportResult()
        await importAccounts(plan, selection, into: &result)
        if selection.includeLibrary { await importLibrary(plan, into: &result) }
        let settings = chosenSettings(plan, selection)
        if settings != BundleSettings(), let patch = try? settings.patch(includeReceipts: true) {
            result.settingsApplied = (try? await target.applySettings(patch: patch)) != nil
        }
        return result
    }

    /// The Mac's settings the person agreed to. The receipts service only goes through when its own switch is on.
    private func chosenSettings(_ plan: ImportPlan, _ selection: ImportSelection) -> BundleSettings {
        var chosen = selection.includeSettings && plan.hasSettings ? plan.settings.withoutReceipts : BundleSettings()
        if selection.includeReceipts, plan.hasReceipts { chosen.receipts = plan.settings.receipts }
        return chosen
    }

    // MARK: Accounts

    private func importAccounts(_ plan: ImportPlan, _ selection: ImportSelection, into result: inout ImportResult) async {
        for row in plan.accounts {
            if row.existsOnPhone {
                await replace(row, selection, into: &result)
            } else if row.credential == .ready, let password = row.account.password {
                do {
                    _ = try await addPasswordAccount(row.account, password: password)
                    result.added.accounts += 1
                } catch {
                    result.failedAccounts.append(row.account.email)
                }
            }
        }
    }

    /// Name, color and aliases always follow the Mac. The servers follow only when they are safe for the stored password:
    /// unchanged hosts after a successful login check. A host change never goes through here.
    private func replace(_ row: PlannedAccount, _ selection: ImportSelection, into result: inout ImportResult) async {
        guard row.serverChange != .hostChanged, selection.replaceAccounts.contains(row.id),
              let existing = try? await findAccount(row.account.email) else { return }
        let move = row.serverChange == .detailsOnly && existing.authKind == .password
        let allowed = move ? await loginWorks(existing.id, on: row.account.server) : false
        if (try? await applyDetails(row.account, to: existing.id, includeServer: allowed)) != nil {
            result.replacedAccounts += 1
            if move && !allowed { result.keptServers.append(row.account.email) }
        }
    }

    private func loginWorks(_ id: AccountID, on server: ServerConfig) async -> Bool {
        (try? await target.storedLoginWorks(id: id, on: server)) ?? false
    }

    private func applyDetails(_ a: BundleAccount, to id: AccountID, includeServer: Bool = false) async throws -> Account {
        var patch = AccountPatch(name: a.name, sortOrder: a.sortOrder, aliases: a.aliases, showInUnified: a.showInUnified)
        patch.color = .some(a.color)
        if includeServer { patch.server = a.server }
        return try await target.updateAccount(id: id, patch)
    }

    private func findAccount(_ email: String) async throws -> Account? {
        try await target.accounts().first { $0.email.lowercased() == email.lowercased() }
    }

    // MARK: Library

    private func importLibrary(_ plan: ImportPlan, into result: inout ImportResult) async {
        let ids = Dictionary(((try? await target.accounts()) ?? []).map { ($0.email.lowercased(), $0.id) }, uniquingKeysWith: { first, _ in first })
        for s in plan.signatures { await save(signature: s, ids, &result) }
        for t in plan.templates {
            if (try? await target.saveTemplate(Template(id: 0, name: t.name, subject: t.subject, html: t.html))) != nil { result.added.templates += 1 } else { result.failedItems += 1 }
        }
        for r in plan.rules { await save(rule: r, ids, &result) }
        for pattern in plan.blockedSenders {
            if (try? await target.blockSender(pattern)) != nil { result.added.blockedSenders += 1 } else { result.failedItems += 1 }
        }
    }

    private func save(signature s: BundleSignature, _ ids: [String: AccountID], _ result: inout ImportResult) async {
        let scoped = s.accountEmails.compactMap { ids[$0.lowercased()] }
        guard s.accountEmails.isEmpty || !scoped.isEmpty else { result.skippedNoAccount += 1; return }
        let sig = Signature(id: 0, name: s.name, html: s.html, accountIds: scoped, defaultNew: s.defaultNew, defaultReply: s.defaultReply)
        if (try? await target.saveSignature(sig)) != nil { result.added.signatures += 1 } else { result.failedItems += 1 }
    }

    private func save(rule r: BundleRule, _ ids: [String: AccountID], _ result: inout ImportResult) async {
        var accountId: AccountID?
        if let email = r.accountEmail {
            guard let id = ids[email.lowercased()] else { result.skippedNoAccount += 1; return }
            accountId = id
        }
        let rule = Rule(id: 0, name: r.name, enabled: r.enabled, accountId: accountId, match: r.match, conditions: r.conditions, actions: r.actions, sortOrder: r.sortOrder)
        if (try? await target.saveRule(rule)) != nil { result.added.rules += 1 } else { result.failedItems += 1 }
    }
}
