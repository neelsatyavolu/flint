import FlintModel
import Foundation

/// A rule being edited. `id` is nil until it is saved (the service creates a rule when `id <= 0`). Port of `ruleValidation.ts`.
struct RuleDraft: Equatable {
    var id: Int?
    var name = ""
    var enabled = true
    var accountId: AccountID?
    var match: RuleMatch = .all
    var conditions: [RuleCondition] = [RuleDraft.newCondition()]
    var actions: [RuleAction] = [.archive]
    var sortOrder = 0

    init(sortOrder: Int = 0) { self.sortOrder = sortOrder }

    init(_ rule: Rule) {
        id = rule.id
        name = rule.name
        enabled = rule.enabled
        accountId = rule.accountId
        match = rule.match
        conditions = rule.conditions
        actions = rule.actions
        sortOrder = rule.sortOrder
    }

    func rule() -> Rule {
        Rule(id: id ?? 0, name: name.trimmingCharacters(in: .whitespaces), enabled: enabled, accountId: accountId, match: match,
             conditions: conditions, actions: actions, sortOrder: sortOrder)
    }

    static func newCondition() -> RuleCondition { RuleCondition(field: .from, op: .contains, value: "") }

    // MARK: Fields, operators and actions

    static let fields: [RuleField] = [.from, .to, .cc, .subject, .body, .anyRecipient, .listId, .hasAttachment]

    static func label(_ field: RuleField) -> String {
        switch field {
        case .from: sl("From")
        case .to: sl("To")
        case .cc: sl("Cc")
        case .subject: sl("Subject")
        case .body: sl("Body")
        case .anyRecipient: sl("Any recipient")
        case .listId: sl("List-Id")
        case .hasAttachment: sl("Has attachment")
        }
    }

    static func label(_ op: RuleOp) -> String {
        switch op {
        case .contains: sl("contains")
        case .equals: sl("is")
        case .endsWith: sl("ends with")
        case .matches: sl("matches pattern")
        case .isTrue: sl("is true")
        }
    }

    static func operators(for field: RuleField) -> [RuleOp] {
        field == .hasAttachment ? [.isTrue] : [.contains, .equals, .endsWith, .matches]
    }

    /// Changing the field keeps the operator when it still applies; "has attachment" takes no value.
    static func with(field: RuleField, on condition: RuleCondition) -> RuleCondition {
        let ops = operators(for: field)
        return RuleCondition(field: field, op: ops.contains(condition.op) ? condition.op : ops[0], value: field == .hasAttachment ? "" : condition.value)
    }

    enum ActionKind: String, CaseIterable, Sendable { case move, archive, trash, markRead, pin, category, mute, notify }

    static func kind(of action: RuleAction) -> ActionKind {
        switch action {
        case .move: .move
        case .archive: .archive
        case .trash: .trash
        case .markRead: .markRead
        case .pin: .pin
        case .category: .category
        case .mute: .mute
        case .notify: .notify
        }
    }

    static func label(_ kind: ActionKind) -> String {
        switch kind {
        case .move: sl("Move to folder")
        case .archive: sl("Archive")
        case .trash: sl("Move to trash")
        case .markRead: sl("Mark as read")
        case .pin: sl("Pin")
        case .category: sl("File as")
        case .mute: sl("Mute")
        case .notify: sl("Notification")
        }
    }

    static func newAction(_ kind: ActionKind) -> RuleAction {
        switch kind {
        case .move: .move(folderPath: "")
        case .archive: .archive
        case .trash: .trash
        case .markRead: .markRead
        case .pin: .pin
        case .category: .category(.newsletters)
        case .mute: .mute
        case .notify: .notify(enabled: false)
        }
    }

    static func label(_ category: MailCategory) -> String {
        switch category {
        case .people: sl("People")
        case .notifications: sl("Notifications")
        case .newsletters: sl("Newsletters")
        }
    }

    // MARK: Validation

    struct Issues: Equatable {
        var name: String?
        var conditions: [String?]
        var actions: [String?]
        var general: [String]

        var isEmpty: Bool { name == nil && general.isEmpty && conditions.allSatisfy { $0 == nil } && actions.allSatisfy { $0 == nil } }
    }

    func validate() -> Issues {
        var general: [String] = []
        if conditions.isEmpty { general.append(sl("Add at least one condition.")) }
        if actions.isEmpty { general.append(sl("Add at least one action.")) }
        return Issues(
            name: name.trimmingCharacters(in: .whitespaces).isEmpty ? sl("Name the rule.") : nil,
            conditions: conditions.map(Self.issue(for:)),
            actions: actions.map { action in
                if case .move(let path) = action, path.trimmingCharacters(in: .whitespaces).isEmpty { return sl("Enter a folder.") }
                return nil
            },
            general: general)
    }

    private static func issue(for c: RuleCondition) -> String? {
        if !operators(for: c.field).contains(c.op) { return sl("This test doesn't apply to that field.") }
        if c.op == .isTrue { return nil }
        if c.value.trimmingCharacters(in: .whitespaces).isEmpty { return sl("Enter a value.") }
        if c.op == .matches, (try? NSRegularExpression(pattern: c.value, options: .caseInsensitive)) == nil { return sl("That pattern isn't valid.") }
        return nil
    }

    // MARK: Summary and order

    /// "If from contains boss: archive, pin".
    static func summary(of rule: Rule) -> String {
        let joiner = rule.match == .all ? sl(" and ") : sl(" or ")
        let conds = rule.conditions.map { c in
            c.op == .isTrue ? label(c.field).lowercased() : "\(label(c.field).lowercased()) \(label(c.op)) \(c.value)"
        }
        let acts = rule.actions.map(describe)
        return String(format: sl("If %@: %@"), conds.isEmpty ? sl("nothing") : conds.joined(separator: joiner), acts.isEmpty ? sl("nothing") : acts.joined(separator: ", "))
    }

    private static func describe(_ action: RuleAction) -> String {
        switch action {
        case .move(let path): String(format: sl("move to %@"), path)
        case .category(let category): String(format: sl("file as %@"), label(category).lowercased())
        case .notify(let on): on ? sl("notify") : sl("no notification")
        default: label(kind(of: action)).lowercased()
        }
    }

    /// Swaps order with the neighbour. Returns the two rules to save, or nil at the edge.
    static func reorder(_ rules: [Rule], id: Int, by direction: Int) -> [Rule]? {
        let sorted = rules.sorted { $0.sortOrder < $1.sortOrder }
        guard let i = sorted.firstIndex(where: { $0.id == id }), sorted.indices.contains(i + direction) else { return nil }
        var a = sorted[i], b = sorted[i + direction]
        let aOrder = a.sortOrder == b.sortOrder ? (direction < 0 ? b.sortOrder + 1 : b.sortOrder - 1) : a.sortOrder
        let bOrder = b.sortOrder
        a.sortOrder = bOrder
        b.sortOrder = aOrder
        return [a, b]
    }
}
