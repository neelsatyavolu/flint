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
    func saveSignature(_ signature: Signature) async throws
    func saveTemplate(_ template: Template) async throws
    func saveRule(_ rule: Rule) async throws
    func blockSender(_ pattern: String) async throws
    func applySettings(patch: JSONValue) async throws
}

public struct ImportResult: Equatable, Sendable {
    public var added = ImportCounts()
    /// Accounts already on the iPhone whose details were replaced.
    public var replacedAccounts = 0
    /// Accounts whose login did not work with the password from the Mac. They stay on the review list.
    public var failedAccounts: [String] = []
    /// Signatures and rules that belong to an account that is not set up on this iPhone.
    public var skippedNoAccount = 0
    public var failedItems = 0
    public var settingsApplied = false
}

public struct BundleImporter: Sendable {
    private let target: any ImportTarget

    public init(target: any ImportTarget) { self.target = target }

    public func library() async throws -> ImportLibrary {
        try await ImportLibrary(accounts: target.accounts())
    }

    /// Adds one account now (the review row's "Add password", or an account the Mac sent a password for).
    public func addPasswordAccount(_ a: BundleAccount, password: String) async throws -> Account {
        let created = try await target.addAccount(AddAccountInput(email: a.email, name: a.name, password: password, provider: a.provider, server: a.server))
        return try await applyDetails(a, to: created.id)
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
        if selection.includeSettings, plan.hasSettings, let patch = try? plan.settings.patch() {
            result.settingsApplied = (try? await target.applySettings(patch: patch)) != nil
        }
        return result
    }

    // MARK: Accounts

    private func importAccounts(_ plan: ImportPlan, _ selection: ImportSelection, into result: inout ImportResult) async {
        for row in plan.accounts {
            if row.existsOnPhone {
                guard selection.replaceAccounts.contains(row.id), let existing = try? await findAccount(row.account.email) else { continue }
                if (try? await applyDetails(row.account, to: existing.id, includeServer: existing.authKind == .password)) != nil { result.replacedAccounts += 1 }
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
