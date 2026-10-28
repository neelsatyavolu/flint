import Foundation
import FlintModel

/// What a rule can look at. `body` is plain text. Header names are lowercase.
public struct RuleMessage: Sendable {
    public var accountId: AccountID
    public var from: [Address]
    public var to: [Address]
    public var cc: [Address]
    public var bcc: [Address]
    public var subject: String
    public var body: String
    public var headers: [String: String]
    public var hasAttachments: Bool

    public init(
        accountId: AccountID, from: [Address] = [], to: [Address] = [], cc: [Address] = [], bcc: [Address] = [],
        subject: String = "", body: String = "", headers: [String: String] = [:], hasAttachments: Bool = false
    ) {
        self.accountId = accountId
        self.from = from
        self.to = to
        self.cc = cc
        self.bcc = bcc
        self.subject = subject
        self.body = body
        self.headers = headers
        self.hasAttachments = hasAttachments
    }
}

/// Rule matching and blocked-sender helpers. Port of `packages/core/src/rules/index.ts`.
/// Substring tests compare UTF-16 code units like JavaScript; user `matches` patterns are JavaScript regexes run with
/// ASCII `\w \d \b` (see `JSRegex`) and an invalid or over-long pattern never matches.
public enum RuleMatcher {
    private static let maxPattern = 200
    private static let maxHaystack = 200_000

    private static func label(_ a: Address) -> String { "\(a.name) <\(a.address)>".lowercased() }

    private static func isAddressField(_ f: RuleField) -> Bool {
        f == .from || f == .to || f == .cc || f == .anyRecipient
    }

    private static func addresses(for field: RuleField, _ m: RuleMessage) -> [Address] {
        switch field {
        case .from: return m.from
        case .to: return m.to
        case .cc: return m.cc
        default: return m.to + m.cc + m.bcc
        }
    }

    private static func haystacks(_ field: RuleField, _ m: RuleMessage) -> [String] {
        switch field {
        case .from: return m.from.map(label)
        case .to: return m.to.map(label)
        case .cc: return m.cc.map(label)
        case .anyRecipient: return (m.to + m.cc + m.bcc).map(label)
        case .subject: return [m.subject.lowercased()]
        case .body: return [String(decoding: Array(m.body.utf16.prefix(maxHaystack)), as: UTF16.self).lowercased()]
        case .listId: return [(m.headers["list-id"] ?? "").lowercased()]
        case .hasAttachment: return []
        }
    }

    private static func includes(_ hay: String, _ value: String) -> Bool {
        hay.range(of: value, options: .literal) != nil
    }

    private static func endsWith(_ hay: String, _ value: String) -> Bool {
        hay.range(of: value, options: [.literal, .backwards, .anchored]) != nil
    }

    public static func matchCondition(_ c: RuleCondition, _ m: RuleMessage) -> Bool {
        if c.field == .hasAttachment { return c.op == .isTrue ? m.hasAttachments : false }
        let value = c.value.lowercased()
        if value.isEmpty && c.op != .matches { return false }

        if c.op == .equals && isAddressField(c.field) {
            return addresses(for: c.field, m).contains { $0.address.lowercased() == value || $0.name.lowercased() == value }
        }
        if c.op == .endsWith && isAddressField(c.field) {
            return addresses(for: c.field, m).contains { endsWith($0.address.lowercased(), value) }
        }
        let hay = haystacks(c.field, m)
        switch c.op {
        case .contains: return hay.contains { includes($0, value) }
        case .equals: return hay.contains { $0 == value }
        case .endsWith: return hay.contains { endsWith($0, value) }
        case .matches: return hay.contains { safeRegex(c.value, $0) }
        case .isTrue: return false
        }
    }

    private static func safeRegex(_ pattern: String, _ text: String) -> Bool {
        if pattern.isEmpty || pattern.utf16.count > maxPattern { return false }
        return JSRegex(pattern, ignoreCase: true)?.test(text) ?? false
    }

    /// A rule with no conditions never matches.
    public static func matchRule(_ rule: Rule, _ m: RuleMessage) -> Bool {
        if !rule.enabled || rule.conditions.isEmpty { return false }
        if let account = rule.accountId, account != m.accountId { return false }
        return rule.match == .all
            ? rule.conditions.allSatisfy { matchCondition($0, m) }
            : rule.conditions.contains { matchCondition($0, m) }
    }

    /// Actions of every matching rule, in rule order (sortOrder, then id). Later category actions win via `resolveCategory`.
    public static func evaluateRules(_ rules: [Rule], _ m: RuleMessage) -> [RuleAction] {
        rules
            .sorted { $0.sortOrder != $1.sortOrder ? $0.sortOrder < $1.sortOrder : $0.id < $1.id }
            .filter { matchRule($0, m) }
            .flatMap(\.actions)
    }

    public static func resolveCategory(_ actions: [RuleAction], fallback: MailCategory) -> MailCategory {
        var out = fallback
        for case .category(let c) in actions { out = c }
        return out
    }

    // MARK: Blocked senders

    private static let domainPattern = JSRegex(literal: #"^@[^@\s]+\.[^@\s]+\z"#)
    private static let addressPattern = JSRegex(literal: #"^[^@\s]+@[^@\s]+\.[^@\s]+\z"#)
    private static let bareDomainPattern = JSRegex(literal: #"^[^@\s]+\.[^@\s]+\z"#)

    /// True when a lowercase address matches a blocked pattern: exact address or '@domain'.
    public static func senderMatchesBlocked(_ address: String, patterns: Set<String>) -> Bool {
        let a = address.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if a.isEmpty || patterns.isEmpty { return false }
        if patterns.contains(a) { return true }
        guard let at = a.lastIndex(of: "@") else { return false }
        return patterns.contains(String(a[at...]))
    }

    /// Normalizes user input into a stored pattern: lowercase address, or '@domain' for a bare domain.
    public static func normalizeBlockPattern(_ input: String) -> String? {
        var v = input.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if v.hasPrefix("<") { v.removeFirst() }
        if v.hasSuffix(">") { v.removeLast() }
        if v.isEmpty { return nil }
        if v.hasPrefix("@") { return domainPattern.test(v) ? v : nil }
        if v.contains("@") { return addressPattern.test(v) ? v : nil }
        return bareDomainPattern.test(v) ? "@" + v : nil
    }
}
