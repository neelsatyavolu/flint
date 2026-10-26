// FROZEN CONTRACT (Wave 1, track 1B). Mirrors packages/core/src/types.ts.
// Changing this file needs the wave lead's sign-off and a note in docs/ios/HANDOFF.md.

import Foundation

/// One Settings model, Codable, same JSON shape as the desktop `settings` table row and the pairing/export bundle.
/// Defaults match `DEFAULT_SETTINGS` in packages/core/src/store/settings.ts. Load stored JSON with `Settings.load(from:)`
/// so keys added in later versions fall back to defaults; apply a patch with `merging(_:)`.
public struct Settings: Codable, Hashable, Sendable {
    public struct Appearance: Codable, Hashable, Sendable {
        public enum Layout: String, Codable, Hashable, Sendable { case split, full }
        public enum Theme: String, Codable, Hashable, Sendable { case system, dark, light }
        public enum Avatars: String, Codable, Hashable, Sendable { case everywhere, list, off }
        public enum EmailAppearance: String, Codable, Hashable, Sendable { case match, light }
        public enum Density: String, Codable, Hashable, Sendable { case comfortable, compact }
        public var layout: Layout = .split
        public var theme: Theme = .system
        public var avatars: Avatars = .everywhere
        public var senderLogos = true
        public var senderPhotos = false
        /// HTML mail in dark mode: `.match` adapts colors, `.light` shows the original white sheet.
        public var emailAppearance: EmailAppearance = .match
        /// 0, 1 or 2.
        public var previewLines = 1
        public var density: Density = .comfortable
        public var accountColors = true
        public init() {}
    }

    public struct Inbox: Codable, Hashable, Sendable {
        public enum MarkReadOnOpen: String, Codable, Hashable, Sendable { case instant, delay, never }
        public enum AfterArchive: String, Codable, Hashable, Sendable { case next, previous, list }
        public enum RemoteImages: String, Codable, Hashable, Sendable {
            case always, never
            case knownSenders = "known_senders"
        }
        public var focused = true
        public var sort: SortOrder = .newest
        public var markReadOnOpen: MarkReadOnOpen = .instant
        public var afterArchive: AfterArchive = .next
        public var blockTrackers = true
        public var remoteImages: RemoteImages = .knownSenders
        public init() {}
    }

    public struct Compose: Codable, Hashable, Sendable {
        /// 0, 5, 10, 20 or 30.
        public var undoSendSeconds = 10
        /// A number picks the signature, null means none, a missing key means "use the signature flagged as default".
        public var defaultSignatureByAccount: [AccountID: Int?] = [:]
        public var defaultReplySignatureByAccount: [AccountID: Int?] = [:]
        public var plainTextOnly = false
        public init() {}
    }

    public struct Receipts: Codable, Hashable, Sendable {
        public var enabled = true
        public var defaultOn = true
        /// Receipts service base URL; empty means not configured.
        public var endpoint = ""
        public var notifyOnOpen = true
        public init() {}
    }

    public struct Notifications: Codable, Hashable, Sendable {
        public enum Scope: String, Codable, Hashable, Sendable { case people, all, none }
        public enum Preview: String, Codable, Hashable, Sendable {
            case senderSubject = "sender_subject"
            case senderSubjectLine = "sender_subject_line"
            case none
        }
        public enum Badge: String, Codable, Hashable, Sendable {
            case unifiedUnread = "unified_unread"
            case peopleUnread = "people_unread"
            case off
        }
        public var enabled = true
        public var scope: Scope = .people
        public var sound = true
        public var soundName = "default"
        public var preview: Preview = .senderSubject
        public var badge: Badge = .unifiedUnread
        public var disabledAccounts: [AccountID] = []
        public init() {}
    }

    /// Kept for JSON compatibility with desktop and pairing. AI is not in iOS v1.
    public struct AI: Codable, Hashable, Sendable {
        public var enabled = true
        public var provider: String?
        public var model: String?
        public var autoSummarize = true
        public var smartReplies = true
        public var autoCategorize = false
        public var writingStyle = ""
        public var replyLanguage = ""
        public init() {}
    }

    /// Kept for JSON compatibility only. The agent API does not exist on iOS.
    public struct Agents: Codable, Hashable, Sendable {
        public var enabled = true
        public var modify = "allow"
        public var send = "ask"
        public init() {}
    }

    public struct Sync: Codable, Hashable, Sendable {
        public var initialDays = 90
        public var bodiesForRecentDays = 14
        public init() {}
    }

    public struct Google: Codable, Hashable, Sendable {
        public var clientId = ""
        public var clientSecret = ""
        public var builtIn: Bool?
        public init() {}
    }

    public struct Updates: Codable, Hashable, Sendable {
        public var mode = "ask"
        public init() {}
    }

    public struct Codes: Codable, Hashable, Sendable {
        public var enabled = true
        public var notify = true
        public var autoCopy = false
        public init() {}
    }

    public var appearance = Appearance()
    public var inbox = Inbox()
    public var compose = Compose()
    public var receipts = Receipts()
    public var notifications = Notifications()
    public var ai = AI()
    public var agents = Agents()
    public var sync = Sync()
    public var google = Google()
    public var updates = Updates()
    public var codes = Codes()

    public init() {}

    public static let `default` = Settings()

    /// Applies a partial JSON patch (deep merge; arrays and scalars replace) and returns a new value.
    public func merging(_ patch: JSONValue) throws -> Settings {
        let base = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(self))
        return try JSONDecoder().decode(Settings.self, from: JSONEncoder().encode(base.merging(patch)))
    }

    /// Decodes stored JSON on top of the defaults, so keys missing from older rows keep their default.
    public static func load(from data: Data) throws -> Settings {
        let stored = try JSONDecoder().decode(JSONValue.self, from: data)
        return try Settings.default.merging(stored)
    }
}
