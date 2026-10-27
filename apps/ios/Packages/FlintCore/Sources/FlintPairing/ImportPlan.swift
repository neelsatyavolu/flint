// What a bundle would change on this iPhone. Import is a merge keyed by email (accounts) or name (the rest). Nothing on
// the iPhone is overwritten unless the person chose "Use the Mac's" for that account.

import FlintModel
import Foundation

/// What is already on the iPhone, as far as the merge needs to know.
public struct ImportLibrary: Sendable {
    public var accounts: [Account]
    public var signatures: [Signature]
    public var templates: [Template]
    public var rules: [Rule]
    public var blockedPatterns: Set<String>

    public init(accounts: [Account] = [], signatures: [Signature] = [], templates: [Template] = [], rules: [Rule] = [], blockedPatterns: Set<String> = []) {
        self.accounts = accounts
        self.signatures = signatures
        self.templates = templates
        self.rules = rules
        self.blockedPatterns = blockedPatterns
    }
}

public enum AccountCredential: Equatable, Sendable {
    /// Nothing to ask for: already on this iPhone, or the Mac sent the app password.
    case ready
    case needsGoogleSignIn
    case needsPassword
}

public struct PlannedAccount: Identifiable, Equatable, Sendable {
    public var account: BundleAccount
    public var existsOnPhone: Bool
    public var credential: AccountCredential
    public var id: String { account.email.lowercased() }
}

public struct ImportPlan: Equatable, Sendable {
    public var deviceName: String
    public var accounts: [PlannedAccount]
    public var signatures: [BundleSignature]
    public var templates: [BundleTemplate]
    public var rules: [BundleRule]
    public var blockedSenders: [String]
    public var settings: BundleSettings
    /// Library items left out because the iPhone already has one with the same name or pattern.
    public var alreadyHere: ImportCounts

    /// Accounts that still need a sign-in or a password before the rest can attach to them.
    public var accountsNeedingCredentials: [PlannedAccount] { accounts.filter { !$0.existsOnPhone && $0.credential != .ready } }
    public var newAccounts: [PlannedAccount] { accounts.filter { !$0.existsOnPhone } }
    public var conflictingAccounts: [PlannedAccount] { accounts.filter(\.existsOnPhone) }
    public var hasSettings: Bool { settings != BundleSettings() }

    public static func make(bundle: PairingBundle, library: ImportLibrary) -> ImportPlan {
        let known = Dictionary(library.accounts.map { ($0.email.lowercased(), $0) }, uniquingKeysWith: { first, _ in first })
        let signatureNames = Set(library.signatures.map { $0.name.lowercased() })
        let templateNames = Set(library.templates.map { $0.name.lowercased() })
        let ruleNames = Set(library.rules.map { $0.name.lowercased() })
        let blocked = Set(library.blockedPatterns.map { $0.lowercased() })

        let signatures = bundle.signatures.filter { !signatureNames.contains($0.name.lowercased()) }
        let templates = bundle.templates.filter { !templateNames.contains($0.name.lowercased()) }
        let rules = bundle.rules.filter { !ruleNames.contains($0.name.lowercased()) }
        var seen = blocked
        let newBlocked = bundle.blockedSenders.filter { seen.insert($0.lowercased()).inserted }
        return ImportPlan(
            deviceName: bundle.device.name,
            accounts: bundle.accounts.map { planned($0, known: known[$0.email.lowercased()] != nil) },
            signatures: signatures, templates: templates, rules: rules, blockedSenders: newBlocked, settings: bundle.settings,
            alreadyHere: ImportCounts(
                signatures: bundle.signatures.count - signatures.count, templates: bundle.templates.count - templates.count,
                rules: bundle.rules.count - rules.count, blockedSenders: bundle.blockedSenders.count - newBlocked.count))
    }

    private static func planned(_ a: BundleAccount, known: Bool) -> PlannedAccount {
        let credential: AccountCredential = known ? .ready : a.needsGoogleSignIn ? .needsGoogleSignIn : a.needsPassword ? .needsPassword : .ready
        return PlannedAccount(account: a, existsOnPhone: known, credential: credential)
    }
}

/// The choices on the review screen.
public struct ImportSelection: Equatable, Sendable {
    /// Emails (lowercased) of accounts already on this iPhone whose details the person wants replaced by the Mac's.
    public var replaceAccounts: Set<String> = []
    public var includeLibrary = true
    public var includeSettings = true

    public init(replaceAccounts: Set<String> = [], includeLibrary: Bool = true, includeSettings: Bool = true) {
        self.replaceAccounts = replaceAccounts
        self.includeLibrary = includeLibrary
        self.includeSettings = includeSettings
    }
}
