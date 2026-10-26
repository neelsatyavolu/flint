// FROZEN CONTRACT (Wave 1, track 1B). Mirrors packages/core/src/types.ts.
// Changing this file needs the wave lead's sign-off and a note in docs/ios/HANDOFF.md.

import Foundation

public enum MailProvider: String, Codable, Hashable, Sendable {
    case gmail, imap
}

public enum AuthKind: String, Codable, Hashable, Sendable {
    case oauthGoogle = "oauth_google"
    case password
}

/// What the sign-in form should tell the user about the password.
public enum ServerHint: String, Codable, Hashable, Sendable {
    case protonBridge = "proton_bridge"
    case appPassword = "app_password"
}

public struct ServerConfig: Codable, Hashable, Sendable {
    public var imapHost: String
    public var imapPort: Int
    public var imapSecure: Bool
    public var smtpHost: String
    public var smtpPort: Int
    public var smtpSecure: Bool
    public var username: String

    public init(imapHost: String, imapPort: Int, imapSecure: Bool, smtpHost: String, smtpPort: Int, smtpSecure: Bool, username: String) {
        self.imapHost = imapHost
        self.imapPort = imapPort
        self.imapSecure = imapSecure
        self.smtpHost = smtpHost
        self.smtpPort = smtpPort
        self.smtpSecure = smtpSecure
        self.username = username
    }
}

/// What autoconfig returns: server settings plus an optional note for the sign-in form. Never stored on an account.
/// JSON is flat like the TypeScript type (server keys beside `hint`).
public struct AutoconfigResult: Codable, Hashable, Sendable {
    public var server: ServerConfig
    public var hint: ServerHint?

    public init(server: ServerConfig, hint: ServerHint? = nil) {
        self.server = server
        self.hint = hint
    }

    private enum CodingKeys: String, CodingKey { case hint }

    public init(from decoder: Decoder) throws {
        server = try ServerConfig(from: decoder)
        hint = try decoder.container(keyedBy: CodingKeys.self).decodeIfPresent(ServerHint.self, forKey: .hint)
    }

    public func encode(to encoder: Encoder) throws {
        try server.encode(to: encoder)
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(hint, forKey: .hint)
    }
}

public enum AvatarSource: String, Codable, Hashable, Sendable {
    case google, custom
}

public struct Account: Codable, Hashable, Sendable, Identifiable {
    public var id: AccountID
    public var email: String
    public var name: String
    public var provider: MailProvider
    public var authKind: AuthKind
    public var server: ServerConfig
    public var color: String?
    public var sortOrder: Int
    public var enabled: Bool
    public var aliases: [String]
    public var createdAt: EpochMs
    /// False: left out of every all-accounts view (unified Inbox, counts, badge, bundles).
    public var showInUnified: Bool
    public var avatarSource: AvatarSource?
    public var avatarUpdatedAt: EpochMs?

    public init(
        id: AccountID, email: String, name: String, provider: MailProvider, authKind: AuthKind, server: ServerConfig,
        color: String? = nil, sortOrder: Int = 0, enabled: Bool = true, aliases: [String] = [], createdAt: EpochMs = 0,
        showInUnified: Bool = true, avatarSource: AvatarSource? = nil, avatarUpdatedAt: EpochMs? = nil
    ) {
        self.id = id
        self.email = email
        self.name = name
        self.provider = provider
        self.authKind = authKind
        self.server = server
        self.color = color
        self.sortOrder = sortOrder
        self.enabled = enabled
        self.aliases = aliases
        self.createdAt = createdAt
        self.showInUnified = showInUnified
        self.avatarSource = avatarSource
        self.avatarUpdatedAt = avatarUpdatedAt
    }

    // JSON is flat like the TypeScript type: the server keys sit beside the account keys.
    private enum CodingKeys: String, CodingKey {
        case id, email, name, provider, authKind, color, sortOrder, enabled, aliases, createdAt
        case showInUnified, avatarSource, avatarUpdatedAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        email = try c.decode(String.self, forKey: .email)
        name = try c.decode(String.self, forKey: .name)
        provider = try c.decode(MailProvider.self, forKey: .provider)
        authKind = try c.decode(AuthKind.self, forKey: .authKind)
        server = try ServerConfig(from: decoder)
        color = try c.decodeIfPresent(String.self, forKey: .color)
        sortOrder = try c.decode(Int.self, forKey: .sortOrder)
        enabled = try c.decode(Bool.self, forKey: .enabled)
        aliases = try c.decode([String].self, forKey: .aliases)
        createdAt = try c.decode(Int.self, forKey: .createdAt)
        showInUnified = try c.decodeIfPresent(Bool.self, forKey: .showInUnified) ?? true
        avatarSource = try c.decodeIfPresent(AvatarSource.self, forKey: .avatarSource)
        avatarUpdatedAt = try c.decodeIfPresent(Int.self, forKey: .avatarUpdatedAt)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(email, forKey: .email)
        try c.encode(name, forKey: .name)
        try c.encode(provider, forKey: .provider)
        try c.encode(authKind, forKey: .authKind)
        try server.encode(to: encoder)
        try c.encode(color, forKey: .color)
        try c.encode(sortOrder, forKey: .sortOrder)
        try c.encode(enabled, forKey: .enabled)
        try c.encode(aliases, forKey: .aliases)
        try c.encode(createdAt, forKey: .createdAt)
        try c.encode(showInUnified, forKey: .showInUnified)
        try c.encode(avatarSource, forKey: .avatarSource)
        try c.encode(avatarUpdatedAt, forKey: .avatarUpdatedAt)
    }
}

/// Password or app-password accounts. Gmail app passwords use provider `.gmail`.
public struct AddAccountInput: Codable, Hashable, Sendable {
    public var email: String
    public var name: String
    public var password: String
    public var provider: MailProvider?
    /// Nil means autoconfig.
    public var server: ServerConfig?

    public init(email: String, name: String, password: String, provider: MailProvider? = nil, server: ServerConfig? = nil) {
        self.email = email
        self.name = name
        self.password = password
        self.provider = provider
        self.server = server
    }
}

/// What an account's secret holds in the secret store. Never logged.
public enum AccountSecret: Codable, Hashable, Sendable {
    case password(String)
    case oauth(accessToken: String, refreshToken: String, expiresAt: EpochMs)

    private enum CodingKeys: String, CodingKey { case password, accessToken, refreshToken, expiresAt }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let password = try c.decodeIfPresent(String.self, forKey: .password) {
            self = .password(password)
        } else {
            self = .oauth(
                accessToken: try c.decode(String.self, forKey: .accessToken),
                refreshToken: try c.decode(String.self, forKey: .refreshToken),
                expiresAt: try c.decode(Int.self, forKey: .expiresAt))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .password(let p): try c.encode(p, forKey: .password)
        case .oauth(let a, let r, let e):
            try c.encode(a, forKey: .accessToken)
            try c.encode(r, forKey: .refreshToken)
            try c.encode(e, forKey: .expiresAt)
        }
    }
}

public enum SyncState: String, Codable, Hashable, Sendable {
    case idle, syncing, error, offline
    case authError = "auth_error"
}

public struct SyncProgress: Codable, Hashable, Sendable {
    public var done: Int
    public var total: Int
    public var folder: String?

    public init(done: Int, total: Int, folder: String? = nil) {
        self.done = done
        self.total = total
        self.folder = folder
    }
}

public struct SyncStatus: Codable, Hashable, Sendable {
    public var accountId: AccountID
    public var state: SyncState
    public var error: String?
    public var lastSyncAt: EpochMs?
    public var progress: SyncProgress?

    public init(accountId: AccountID, state: SyncState, error: String? = nil, lastSyncAt: EpochMs? = nil, progress: SyncProgress? = nil) {
        self.accountId = accountId
        self.state = state
        self.error = error
        self.lastSyncAt = lastSyncAt
        self.progress = progress
    }
}
