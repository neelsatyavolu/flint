// Bundle v1 as the iPhone reads it (packages/core/src/pairing/bundle.ts is the other half; both decode and
// re-encode packages/core/fixtures/pairing-bundle.json). Unknown keys are dropped. Nothing here can carry a token:
// the only secret is an optional app password.

import FlintModel
import Foundation

public struct BundleServer: Codable, Hashable, Sendable {
    public var host: String
    public var port: Int
    public var secure: Bool
}

public struct BundleAccount: Codable, Hashable, Sendable {
    public var email: String
    public var name: String
    public var provider: MailProvider
    public var authKind: AuthKind
    public var imap: BundleServer
    public var smtp: BundleServer
    public var username: String
    public var color: String?
    public var aliases: [String]
    public var showInUnified: Bool
    public var sortOrder: Int
    public var avatar: String?
    public var password: String?

    /// Google accounts arrive without a login; so do password accounts the user chose not to send passwords for.
    public var needsGoogleSignIn: Bool { authKind == .oauthGoogle }
    public var needsPassword: Bool { authKind == .password && (password ?? "").isEmpty }

    public var server: ServerConfig {
        ServerConfig(imapHost: imap.host, imapPort: imap.port, imapSecure: imap.secure, smtpHost: smtp.host, smtpPort: smtp.port, smtpSecure: smtp.secure, username: username)
    }
}

public struct BundleSignature: Codable, Hashable, Sendable {
    public var name: String
    public var html: String
    public var accountEmails: [String]
    public var defaultNew: Bool
    public var defaultReply: Bool
}

public struct BundleTemplate: Codable, Hashable, Sendable {
    public var name: String
    public var subject: String
    public var html: String
}

public struct BundleRule: Codable, Hashable, Sendable {
    public var name: String
    public var enabled: Bool
    public var accountEmail: String?
    public var match: RuleMatch
    public var conditions: [RuleCondition]
    public var actions: [RuleAction]
    public var sortOrder: Int

    private enum CodingKeys: String, CodingKey { case name, enabled, accountEmail, match, conditions, actions, sortOrder }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decode(String.self, forKey: .name)
        enabled = try c.decode(Bool.self, forKey: .enabled)
        accountEmail = try c.decodeIfPresent(String.self, forKey: .accountEmail)
        match = try c.decode(RuleMatch.self, forKey: .match)
        conditions = try c.decode([RuleCondition].self, forKey: .conditions)
        actions = try c.decode([RuleAction].self, forKey: .actions)
        sortOrder = try c.decode(Int.self, forKey: .sortOrder)
    }

    /// The key is always written, as `null` for a rule on every account, the way the Mac writes it.
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(name, forKey: .name)
        try c.encode(enabled, forKey: .enabled)
        try c.encode(accountEmail, forKey: .accountEmail)
        try c.encode(match, forKey: .match)
        try c.encode(conditions, forKey: .conditions)
        try c.encode(actions, forKey: .actions)
        try c.encode(sortOrder, forKey: .sortOrder)
    }
}

public struct BundleSettings: Codable, Hashable, Sendable {
    public struct Compose: Codable, Hashable, Sendable { public var undoSendSeconds: Int? }
    public struct Sync: Codable, Hashable, Sendable { public var initialDays: Int?; public var bodiesForRecentDays: Int? }
    public struct Inbox: Codable, Hashable, Sendable { public var focused: Bool? }
    public struct Receipts: Codable, Hashable, Sendable { public var enabled: Bool?; public var defaultOn: Bool?; public var endpoint: String? }
    public struct Appearance: Codable, Hashable, Sendable { public var theme: Settings.Appearance.Theme? }
    public struct Notifications: Codable, Hashable, Sendable { public var scope: Settings.Notifications.Scope? }

    public var compose: Compose?
    public var sync: Sync?
    public var inbox: Inbox?
    public var receipts: Receipts?
    public var appearance: Appearance?
    public var notifications: Notifications?

    public init() {}

    /// The nested object `FlintService.updateSettings(patch:)` takes: only keys the Mac sent. The receipts service is left out
    /// unless asked for, because it decides which server learns when a sent mail is opened.
    public func patch(includeReceipts: Bool = false) throws -> JSONValue {
        let data = try JSONEncoder().encode(includeReceipts ? self : withoutReceipts)
        return try JSONDecoder().decode(JSONValue.self, from: data)
    }

    public var withoutReceipts: BundleSettings {
        var copy = self
        copy.receipts = nil
        return copy
    }

    /// The host of the Mac's receipts endpoint, for the review row. Nil when the Mac sent none or it is not an https address,
    /// since the iPhone ignores anything else and keeps its own.
    public var receiptsHost: String? {
        receipts?.endpoint.flatMap { raw -> String? in
            guard let url = URL(string: raw.trimmingCharacters(in: .whitespaces)), url.scheme?.lowercased() == "https" else { return nil }
            return url.host
        }
    }
}

public struct PairingBundle: Codable, Hashable, Sendable {
    public var v: Int
    public var createdAt: Int
    public var device: Device
    public var accounts: [BundleAccount]
    public var signatures: [BundleSignature]
    public var templates: [BundleTemplate]
    public var rules: [BundleRule]
    public var blockedSenders: [String]
    public var settings: BundleSettings

    public struct Device: Codable, Hashable, Sendable { public var name: String }
}

public enum BundleLimits {
    public static let accounts = 20, signatures = 100, templates = 200, rules = 500, blockedSenders = 5000
    public static let conditions = 20, actions = 20, aliases = 50, avatarChars = 64 * 1024
    public static let undoSendSeconds: Set<Int> = [0, 5, 10, 20, 30]
}

public extension PairingBundle {
    static let version = 1

    /// Decodes and validates bundle bytes. Throws `bundleTooLarge`, `unsupportedVersion` or `malformedBundle`.
    static func decode(_ data: Data) throws -> PairingBundle {
        guard data.count <= PairingLimits.maxBundleBytes else { throw PairingError.bundleTooLarge }
        if let head = try? JSONDecoder().decode(VersionProbe.self, from: data), head.v != version {
            throw head.v > version ? PairingError.unsupportedVersion : PairingError.malformedBundle
        }
        guard let bundle = try? JSONDecoder().decode(PairingBundle.self, from: data), bundle.isWithinLimits else { throw PairingError.malformedBundle }
        return bundle
    }

    func encoded() throws -> Data { try JSONEncoder().encode(self) }

    private struct VersionProbe: Decodable { let v: Int }

    var isWithinLimits: Bool {
        v == Self.version && device.name.count <= 100
            && accounts.count <= BundleLimits.accounts && signatures.count <= BundleLimits.signatures
            && templates.count <= BundleLimits.templates && rules.count <= BundleLimits.rules && blockedSenders.count <= BundleLimits.blockedSenders
            && accounts.allSatisfy(Self.valid) && rules.allSatisfy { $0.conditions.count <= BundleLimits.conditions && $0.actions.count <= BundleLimits.actions }
            && Self.validSettings(settings)
    }

    private static func valid(_ a: BundleAccount) -> Bool {
        a.email.count >= 3 && a.email.count <= 320 && a.aliases.count <= BundleLimits.aliases && (a.avatar?.count ?? 0) <= BundleLimits.avatarChars
            && [a.imap, a.smtp].allSatisfy { (1...65535).contains($0.port) && !$0.host.isEmpty && $0.host.count <= 255 } && (a.password?.count ?? 0) <= 1024
    }

    private static func validSettings(_ s: BundleSettings) -> Bool {
        (s.compose?.undoSendSeconds).map(BundleLimits.undoSendSeconds.contains) ?? true
            && (s.sync?.initialDays).map { (1...3650).contains($0) } ?? true
            && (s.sync?.bodiesForRecentDays).map { (0...365).contains($0) } ?? true
            && (s.receipts?.endpoint?.count ?? 0) <= 512
    }
}
