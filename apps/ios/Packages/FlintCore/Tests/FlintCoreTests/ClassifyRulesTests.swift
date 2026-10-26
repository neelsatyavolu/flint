import Foundation
import Testing
import FlintModel
@testable import FlintClassify

@Suite("Classify: rules")
struct ClassifyRulesTests {
    private func message(_ v: JSONValue?) throws -> RuleMessage {
        guard let o = v?.object else { throw FlintError(.invalid, "message") }
        func addrs(_ k: String) throws -> [Address] { try (o[k] ?? .array([])).decoded([Address].self) }
        return RuleMessage(
            accountId: o["accountId"]?.string ?? "", from: try addrs("from"), to: try addrs("to"), cc: try addrs("cc"), bcc: try addrs("bcc"),
            subject: o["subject"]?.string ?? "", body: o["body"]?.string ?? "", headers: (o["headers"] ?? .null).stringMap,
            hasAttachments: o["hasAttachments"]?.bool ?? false
        )
    }

    @Test func fixtureCases() throws {
        let file = try ClassifyFixtureFile.load("rules")
        #expect(file.cases.count >= 40)
        for c in file.cases {
            switch c.input["fn"]?.string {
            case "matchCondition":
                let cond: RuleCondition = try (c.input["condition"] ?? .null).decoded()
                #expect(RuleMatcher.matchCondition(cond, try message(c.input["message"])) == c.expect.bool, "\(c.name)")
            case "matchRule":
                let rule: Rule = try (c.input["rule"] ?? .null).decoded()
                #expect(RuleMatcher.matchRule(rule, try message(c.input["message"])) == c.expect.bool, "\(c.name)")
            case "evaluateRules":
                let rules: [Rule] = try (c.input["rules"] ?? .null).decoded()
                let expected: [RuleAction] = try c.expect.decoded()
                #expect(RuleMatcher.evaluateRules(rules, try message(c.input["message"])) == expected, "\(c.name)")
            case "resolveCategory":
                let actions: [RuleAction] = try (c.input["actions"] ?? .null).decoded()
                let fallback = MailCategory(rawValue: c.input["fallback"]?.string ?? "") ?? .people
                #expect(RuleMatcher.resolveCategory(actions, fallback: fallback).rawValue == c.expect.string, "\(c.name)")
            case "senderMatchesBlocked":
                let blocked = Set((c.input["blocked"]?.array ?? []).compactMap(\.string))
                #expect(RuleMatcher.senderMatchesBlocked(c.input["sender"]?.string ?? "", patterns: blocked) == c.expect.bool, "\(c.name)")
            case "normalizeBlockPattern":
                #expect(RuleMatcher.normalizeBlockPattern(c.input["value"]?.string ?? "") == c.expect.string, "\(c.name)")
            case let other:
                Issue.record("unknown fn \(other ?? "nil") in \(c.name)")
            }
        }
    }

    private let base = RuleMessage(accountId: "a1", from: [Address(name: "Zoë Müller", address: "zoe@例え.jp")], subject: "ご注文の確認", body: "Order 12345 café")

    @Test func matchesRegexIsCaseInsensitiveAndSafe() {
        #expect(RuleMatcher.matchCondition(RuleCondition(field: .body, op: .matches, value: #"order \d+"#), base))
        #expect(RuleMatcher.matchCondition(RuleCondition(field: .subject, op: .matches, value: "注文"), base))
        // \w is ASCII like JavaScript: "café" does not satisfy "caf\w$".
        #expect(!RuleMatcher.matchCondition(RuleCondition(field: .body, op: .matches, value: #"caf\w\z"#), base))
        #expect(!RuleMatcher.matchCondition(RuleCondition(field: .body, op: .matches, value: "(unclosed"), base))
        #expect(!RuleMatcher.matchCondition(RuleCondition(field: .body, op: .matches, value: String(repeating: "a", count: 201)), base))
    }

    @Test func substringsUseUTF16LikeJavaScript() {
        #expect(RuleMatcher.matchCondition(RuleCondition(field: .from, op: .contains, value: "müller"), base))
        #expect(RuleMatcher.matchCondition(RuleCondition(field: .from, op: .endsWith, value: ".jp"), base))
        #expect(!RuleMatcher.matchCondition(RuleCondition(field: .subject, op: .contains, value: ""), base))
    }

    @Test func accountScopeAndDisabled() {
        let cond = RuleCondition(field: .subject, op: .contains, value: "注文")
        var rule = Rule(id: 1, name: "r", accountId: "other", conditions: [cond], actions: [.archive])
        #expect(!RuleMatcher.matchRule(rule, base))
        rule.accountId = "a1"
        #expect(RuleMatcher.matchRule(rule, base))
        rule.enabled = false
        #expect(!RuleMatcher.matchRule(rule, base))
        rule.enabled = true
        rule.conditions = []
        #expect(!RuleMatcher.matchRule(rule, base))
    }

    @Test func anyMatchAndSortTieBreak() {
        let yes = RuleCondition(field: .subject, op: .contains, value: "注文")
        let no = RuleCondition(field: .subject, op: .contains, value: "zzz")
        let anyRule = Rule(id: 2, name: "a", match: .any, conditions: [no, yes], actions: [.pin], sortOrder: 1)
        let early = Rule(id: 3, name: "b", conditions: [yes], actions: [.mute], sortOrder: 1)
        let first = Rule(id: 1, name: "c", conditions: [yes], actions: [.trash], sortOrder: 0)
        #expect(RuleMatcher.evaluateRules([early, anyRule, first], base) == [.trash, .pin, .mute])
    }
}
