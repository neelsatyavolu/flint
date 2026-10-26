// The adapter the store needs (HANDOFF 2A): FlintStore depends only on FlintModel, so the service hands it the real
// categorizer and rule matcher from FlintClassify. A store built without this silently files everything as people.

import FlintClassify
import FlintModel
import FlintStore

public struct ClassifierAdapter: MailClassifier {
    public init() {}

    public func category(from: Address?, headers: [String: String], isKnownContact: Bool, subject: String) -> MailCategory {
        Categorizer.categorize(CategorizeInput(from: from, headers: headers, isKnownContact: isKnownContact, subject: subject))
    }

    public func ruleActions(
        rules: [Rule], accountId: AccountID, from: [Address], to: [Address], cc: [Address], bcc: [Address],
        subject: String, body: String, headers: [String: String], hasAttachments: Bool
    ) -> [RuleAction] {
        let message = RuleMessage(
            accountId: accountId, from: from, to: to, cc: cc, bcc: bcc, subject: subject, body: body, headers: headers,
            hasAttachments: hasAttachments)
        return RuleMatcher.evaluateRules(rules, message)
    }
}
