// FROZEN CONTRACT (Wave 1, track 1B). Mirrors packages/core/src/types.ts.
// Changing this file needs the wave lead's sign-off and a note in docs/ios/HANDOFF.md.

import Foundation

public enum RuleField: String, Codable, Hashable, Sendable {
    case from, to, cc, subject, body
    case anyRecipient = "any_recipient"
    case listId = "list_id"
    case hasAttachment = "has_attachment"
}

public enum RuleOp: String, Codable, Hashable, Sendable {
    case contains, equals, matches
    case endsWith = "ends_with"
    case isTrue = "is_true"
}

public struct RuleCondition: Codable, Hashable, Sendable {
    public var field: RuleField
    public var op: RuleOp
    public var value: String

    public init(field: RuleField, op: RuleOp, value: String = "") {
        self.field = field
        self.op = op
        self.value = value
    }
}

/// JSON shape matches TypeScript: `{ "type": "move", "folderPath": "..." }`, `{ "type": "category", "category": "..." }`,
/// `{ "type": "notify", "enabled": true }`, `{ "type": "archive" }`.
public enum RuleAction: Codable, Hashable, Sendable {
    case move(folderPath: String)
    case archive
    case trash
    case markRead
    case pin
    case category(MailCategory)
    case mute
    case notify(enabled: Bool)

    private enum CodingKeys: String, CodingKey { case type, folderPath, category, enabled }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.decode(String.self, forKey: .type) {
        case "move": self = .move(folderPath: try c.decode(String.self, forKey: .folderPath))
        case "archive": self = .archive
        case "trash": self = .trash
        case "mark_read": self = .markRead
        case "pin": self = .pin
        case "category": self = .category(try c.decode(MailCategory.self, forKey: .category))
        case "mute": self = .mute
        case "notify": self = .notify(enabled: try c.decode(Bool.self, forKey: .enabled))
        case let other:
            throw DecodingError.dataCorruptedError(forKey: .type, in: c, debugDescription: "Unknown rule action \(other)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .move(let path): try c.encode("move", forKey: .type); try c.encode(path, forKey: .folderPath)
        case .archive: try c.encode("archive", forKey: .type)
        case .trash: try c.encode("trash", forKey: .type)
        case .markRead: try c.encode("mark_read", forKey: .type)
        case .pin: try c.encode("pin", forKey: .type)
        case .category(let cat): try c.encode("category", forKey: .type); try c.encode(cat, forKey: .category)
        case .mute: try c.encode("mute", forKey: .type)
        case .notify(let on): try c.encode("notify", forKey: .type); try c.encode(on, forKey: .enabled)
        }
    }
}

public enum RuleMatch: String, Codable, Hashable, Sendable {
    case all, any
}

public struct Rule: Codable, Hashable, Sendable, Identifiable {
    public var id: Int
    public var name: String
    public var enabled: Bool
    public var accountId: AccountID?
    public var match: RuleMatch
    public var conditions: [RuleCondition]
    public var actions: [RuleAction]
    public var sortOrder: Int

    public init(id: Int, name: String, enabled: Bool = true, accountId: AccountID? = nil, match: RuleMatch = .all, conditions: [RuleCondition], actions: [RuleAction], sortOrder: Int = 0) {
        self.id = id
        self.name = name
        self.enabled = enabled
        self.accountId = accountId
        self.match = match
        self.conditions = conditions
        self.actions = actions
        self.sortOrder = sortOrder
    }
}

public struct Contact: Codable, Hashable, Sendable {
    public var email: String
    public var name: String
    public var score: Double

    public init(email: String, name: String, score: Double) {
        self.email = email
        self.name = name
        self.score = score
    }
}

public struct BlockedSender: Hashable, Sendable {
    public var pattern: String
    public var createdAt: EpochMs

    public init(pattern: String, createdAt: EpochMs) {
        self.pattern = pattern
        self.createdAt = createdAt
    }
}
