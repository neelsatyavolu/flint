// Rules and blocked senders. Ported from store/rulesRepo.ts. Rule matching itself is the classifier's (FlintClassify).

import FlintModel
import Foundation
import GRDB

enum RulesSQL {
    static func rule(_ r: Row) -> Rule {
        Rule(
            id: r["id"], name: r["name"], enabled: r.bool("enabled"), accountId: r["account_id"],
            match: (r["match"] as String) == "any" ? .any : .all,
            conditions: JSONColumn.decode(r["conditions_json"], fallback: [RuleCondition]()),
            actions: JSONColumn.decode(r["actions_json"], fallback: [RuleAction]()), sortOrder: r["sort_order"])
    }

    static func list(_ db: Database) throws -> [Rule] {
        try db.all("SELECT * FROM rules ORDER BY sort_order, id").map(rule)
    }

    static func get(_ db: Database, _ id: Int) throws -> Rule? {
        try db.first("SELECT * FROM rules WHERE id = ?", id).map(rule)
    }

    /// Enabled rules that apply to this account, in order.
    static func list(_ db: Database, accountId: AccountID) throws -> [Rule] {
        try list(db).filter { $0.enabled && ($0.accountId == nil || $0.accountId == accountId) }
    }

    static func validate(_ r: Rule) -> Bool {
        !r.name.isEmpty && r.name.count <= 120 && r.conditions.count <= 20 && r.conditions.allSatisfy { $0.value.count <= 500 }
            && (1...10).contains(r.actions.count)
            && r.actions.allSatisfy { if case .move(let path) = $0 { return !path.isEmpty } else { return true } }
    }

    static func save(_ db: Database, _ r: Rule, now: EpochMs) throws -> Rule {
        guard validate(r) else { throw FlintError(.invalid, "That rule is not valid.") }
        let conditions = JSONColumn.encode(r.conditions)
        let actions = JSONColumn.encode(r.actions)
        if r.id > 0 {
            guard try get(db, r.id) != nil else { throw FlintError(.notFound, "That rule no longer exists.") }
            try db.run(
                "UPDATE rules SET name=?, enabled=?, account_id=?, match=?, conditions_json=?, actions_json=?, sort_order=? WHERE id=?",
                r.name, r.enabled, r.accountId, r.match.rawValue, conditions, actions, r.sortOrder, r.id)
            return try get(db, r.id)!
        }
        let id = try db.insert(
            "INSERT INTO rules (name, enabled, account_id, match, conditions_json, actions_json, sort_order, created_at) VALUES (?,?,?,?,?,?,?,?)",
            r.name, r.enabled, r.accountId, r.match.rawValue, conditions, actions, r.sortOrder, now)
        return try get(db, id)!
    }

    // MARK: Blocked senders

    /// Normalizes user input into a stored pattern: lowercase address, or '@domain' for a bare domain.
    static func normalizeBlockPattern(_ input: String) -> String? {
        var v = input.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if v.hasPrefix("<") { v.removeFirst() }
        if v.hasSuffix(">") { v.removeLast() }
        if v.isEmpty { return nil }
        func matches(_ pattern: String) -> Bool { v.range(of: pattern, options: .regularExpression) != nil }
        if v.hasPrefix("@") { return matches("^@[^@\\s]+\\.[^@\\s]+$") ? v : nil }
        if v.contains("@") { return matches("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$") ? v : nil }
        return matches("^[^@\\s]+\\.[^@\\s]+$") ? "@\(v)" : nil
    }

    /// True when a lowercase address matches a blocked pattern: exact address or '@domain'.
    static func senderMatchesBlocked(_ address: String, _ patterns: Set<String>) -> Bool {
        let a = address.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if a.isEmpty || patterns.isEmpty { return false }
        if patterns.contains(a) { return true }
        guard let at = a.lastIndex(of: "@") else { return false }
        return patterns.contains(String(a[at...]))
    }

    static func blockedPatterns(_ db: Database) throws -> Set<String> {
        Set(try String.fetchAll(db, sql: "SELECT pattern FROM blocked_senders"))
    }
}

extension GRDBStore: RulesRepository {
    public func listRules() async throws -> [Rule] {
        try await read { db in try RulesSQL.list(db) }
    }

    public func rule(id: Int) async throws -> Rule? {
        try await read { db in try RulesSQL.get(db, id) }
    }

    /// Enabled rules that apply to the account (its own and the all-accounts ones), in order.
    public func listRules(accountId: AccountID) async throws -> [Rule] {
        try await read { db in try RulesSQL.list(db, accountId: accountId) }
    }

    /// `rule.id <= 0` creates; otherwise replaces.
    public func saveRule(_ rule: Rule) async throws -> Rule {
        let now = clock()
        return try await write { db in try RulesSQL.save(db, rule, now: now) }
    }

    public func deleteRule(_ id: Int) async throws {
        try await write { db in try db.run("DELETE FROM rules WHERE id = ?", id) }
    }

    /// Accepts an address, '@domain' or a bare domain. Returns the stored pattern.
    public func blockSender(_ input: String) async throws -> String {
        guard let pattern = RulesSQL.normalizeBlockPattern(input) else {
            throw FlintError(.invalid, "Enter an email address or a domain to block.")
        }
        let now = clock()
        return try await write { db in
            try db.run("INSERT OR IGNORE INTO blocked_senders (pattern, created_at) VALUES (?, ?)", pattern, now)
            return pattern
        }
    }

    public func unblockSender(_ input: String) async throws -> String? {
        let pattern = RulesSQL.normalizeBlockPattern(input) ?? input.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return try await write { db in
            try db.run("DELETE FROM blocked_senders WHERE pattern = ?", pattern) > 0 ? pattern : nil
        }
    }

    public func listBlocked() async throws -> [BlockedSender] {
        try await read { db in
            try db.all("SELECT pattern, created_at FROM blocked_senders ORDER BY created_at DESC, pattern")
                .map { BlockedSender(pattern: $0["pattern"], createdAt: $0["created_at"]) }
        }
    }

    public func blockedPatterns() async throws -> Set<String> {
        try await read { db in try RulesSQL.blockedPatterns(db) }
    }
}
