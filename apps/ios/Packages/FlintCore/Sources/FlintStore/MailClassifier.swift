// The two decisions ingest and recategorization borrow from the classifier module (FlintClassify, track 2D):
// which category a message gets and which rule actions a message triggers. FlintStore depends only on FlintModel,
// so the service (2F) passes a thin adapter over `Categorizer` and `RuleMatcher`. Everything else the store needs
// (rollups, blocked senders, thread keys) lives here.

import FlintModel

public protocol MailClassifier: Sendable {
    /// Category of a received message. Known contacts are always people.
    func category(from: Address?, headers: [String: String], isKnownContact: Bool, subject: String) -> MailCategory

    /// Actions of every rule that matches the message, in rule order (sortOrder, then id). `rules` are already limited to the account.
    func ruleActions(
        rules: [Rule], accountId: AccountID, from: [Address], to: [Address], cc: [Address], bcc: [Address],
        subject: String, body: String, headers: [String: String], hasAttachments: Bool
    ) -> [RuleAction]
}

/// Used when no classifier is given: everything is people and no rule ever fires.
public struct PeopleClassifier: MailClassifier {
    public init() {}

    public func category(from: Address?, headers: [String: String], isKnownContact: Bool, subject: String) -> MailCategory { .people }

    public func ruleActions(
        rules: [Rule], accountId: AccountID, from: [Address], to: [Address], cc: [Address], bcc: [Address],
        subject: String, body: String, headers: [String: String], hasAttachments: Bool
    ) -> [RuleAction] { [] }
}
