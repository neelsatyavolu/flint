import FlintModel
import SwiftUI

/// Rules list, "run on existing mail", and a link to blocked senders.
struct RulesPage: View {
    @Environment(SettingsLibrary.self) private var library

    var body: some View {
        SettingsPage(title: sl("Rules"), identifier: "rules") {
            SettingsGroup(title: sl("Rules"), note: sl("Rules sort new mail as it arrives, in the order shown.")) {
                ForEach(library.rules) { rule in
                    SettingsLinkRow(
                        title: rule.name.isEmpty ? sl("Untitled") : rule.name, detail: RuleDraft.summary(of: rule),
                        value: rule.enabled ? nil : sl("Off"), destination: SettingsDestination.rule(rule.id), identifier: "settings.rule.\(rule.id)")
                }
                if library.isLoaded, library.rules.isEmpty {
                    Text("No rules yet.", tableName: "Settings").flintText(.body, color: FlintColor.fg3).padding(FlintMetrics.Space.s4)
                }
                SettingsLinkRow(icon: .plus, title: sl("New rule"), destination: SettingsDestination.rule(nil), identifier: "settings.rule.new")
            }
            if !library.rules.isEmpty {
                SettingsButton(title: sl("Apply rules to existing mail"), identifier: "settings.rules.apply") {
                    Task { await library.applyRules() }
                }
                .padding(FlintMetrics.Space.s4)
            }
            SettingsGroup(title: sl("Blocked senders")) {
                SettingsLinkRow(
                    icon: .ban, title: sl("Blocked senders"), value: "\(library.blocked.count)",
                    destination: SettingsDestination.blocked, identifier: "settings.blocked.open")
            }
        }
    }
}

struct BlockedSendersView: View {
    @Environment(SettingsLibrary.self) private var library

    var body: some View {
        SettingsPage(title: sl("Blocked senders"), identifier: "blocked") {
            Text("Mail from these senders goes to Blocked and never reaches the inbox.", tableName: "Settings")
                .flintText(.body, color: FlintColor.fg3)
                .padding(FlintMetrics.Space.s4)
            FlintHairline()
            ForEach(library.blocked, id: \.pattern) { sender in
                SettingsRowLayout(icon: .ban, title: sender.pattern, detail: String(format: sl("Blocked %@"), FlintTime.current.fullDate(sender.createdAt))) {
                    Button { Task { await library.unblock(sender.pattern) } } label: { Text("Unblock", tableName: "Settings") }
                        .buttonStyle(FlintButtonStyle(kind: .ghost))
                        .accessibilityIdentifier("settings.blocked.unblock.\(sender.pattern)")
                }
                .accessibilityIdentifier("settings.blocked.\(sender.pattern)")
            }
            if library.isLoaded, library.blocked.isEmpty {
                Text("No blocked senders. Block a sender from the message menu.", tableName: "Settings")
                    .flintText(.body, color: FlintColor.fg3).padding(FlintMetrics.Space.s4)
                    .accessibilityIdentifier("settings.blocked.empty")
            }
        }
    }
}

struct RuleEditorView: View {
    let ruleId: Int?
    @Environment(AppModel.self) private var model
    @Environment(SettingsLibrary.self) private var library
    @Environment(\.dismiss) private var dismiss
    @State private var draft: RuleDraft?
    @State private var tried = false
    @State private var busy = false

    var body: some View {
        SettingsPage(title: ruleId == nil ? sl("New rule") : sl("Rule"), identifier: "rule") {
            if draft != nil { editor }
        }
        .task(id: library.isLoaded) { loadDraft() }
    }

    private func loadDraft() {
        guard draft == nil, library.isLoaded else { return }
        if let ruleId, let existing = library.rules.first(where: { $0.id == ruleId }) {
            draft = RuleDraft(existing)
        } else if ruleId == nil {
            draft = RuleDraft(sortOrder: (library.rules.map(\.sortOrder).max() ?? 0) + 1)
        }
    }

    @ViewBuilder private var editor: some View {
        let binding = Binding(get: { draft ?? RuleDraft() }, set: { draft = $0 })
        let issues = tried ? binding.wrappedValue.validate() : nil
        SettingsField(label: sl("Name"), text: binding.name, prompt: sl("Receipts"), invalid: issues?.name != nil, identifier: "settings.rule.name")
        SettingsFieldError(message: issues?.name)
        SettingsToggleRow(title: sl("Rule is on"), isOn: binding.enabled, identifier: "settings.rule.enabled").padding(.top, FlintMetrics.Space.s3)
        SettingsChoiceRow(
            title: sl("Account"), selection: binding.accountId,
            choices: [(value: nil as AccountID?, label: sl("All accounts"))] + model.accounts.map { (value: Optional($0.id), label: $0.email) },
            identifier: "settings.rule.account")
        SettingsChoiceRow(
            title: sl("Match"), selection: binding.match,
            choices: [(value: RuleMatch.all, label: sl("All conditions")), (value: RuleMatch.any, label: sl("Any condition"))],
            identifier: "settings.rule.match")
        SettingsGroup(title: sl("If")) {
            ForEach(binding.wrappedValue.conditions.indices, id: \.self) { i in
                ConditionEditor(condition: conditionBinding(i, binding), index: i, issue: issue(issues?.conditions, i)) {
                    binding.wrappedValue.conditions.remove(at: i)
                }
            }
            addButton(sl("Add condition"), id: "settings.rule.addCondition") { binding.wrappedValue.conditions.append(RuleDraft.newCondition()) }
        }
        SettingsGroup(title: sl("Then")) {
            ForEach(binding.wrappedValue.actions.indices, id: \.self) { i in
                ActionEditor(action: actionBinding(i, binding), index: i, accountId: binding.wrappedValue.accountId, issue: issue(issues?.actions, i)) {
                    binding.wrappedValue.actions.remove(at: i)
                }
            }
            addButton(sl("Add action"), id: "settings.rule.addAction") { binding.wrappedValue.actions.append(.archive) }
        }
        ForEach(issues?.general ?? [], id: \.self) { SettingsFieldError(message: $0) }
        footer(binding)
    }

    private func issue(_ list: [String?]?, _ i: Int) -> String? { list?[safe: i] ?? nil }

    private func conditionBinding(_ i: Int, _ draft: Binding<RuleDraft>) -> Binding<RuleCondition> {
        Binding(
            get: { draft.wrappedValue.conditions[safe: i] ?? RuleDraft.newCondition() },
            set: { if draft.wrappedValue.conditions.indices.contains(i) { draft.wrappedValue.conditions[i] = $0 } })
    }

    private func actionBinding(_ i: Int, _ draft: Binding<RuleDraft>) -> Binding<RuleAction> {
        Binding(
            get: { draft.wrappedValue.actions[safe: i] ?? .archive },
            set: { if draft.wrappedValue.actions.indices.contains(i) { draft.wrappedValue.actions[i] = $0 } })
    }

    private func addButton(_ title: String, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            SettingsRowLayout(icon: .plus, title: title) { EmptyView() }.contentShape(Rectangle())
        }
        .buttonStyle(FlintPressStyle(radius: 0))
        .accessibilityIdentifier(id)
    }

    private func footer(_ binding: Binding<RuleDraft>) -> some View {
        VStack(spacing: FlintMetrics.Space.s3) {
            SettingsButton(title: sl("Save rule"), kind: .primary, disabled: busy, identifier: "settings.rule.save") {
                tried = true
                guard binding.wrappedValue.validate().isEmpty else { return }
                busy = true
                Task {
                    defer { busy = false }
                    if await library.save(binding.wrappedValue.rule()) { dismiss() }
                }
            }
            if let id = binding.wrappedValue.id {
                HStack(spacing: FlintMetrics.Space.s3) {
                    SettingsButton(title: sl("Move up"), identifier: "settings.rule.up") { Task { await library.moveRule(id: id, by: -1); dismiss() } }
                    SettingsButton(title: sl("Move down"), identifier: "settings.rule.down") { Task { await library.moveRule(id: id, by: 1); dismiss() } }
                }
                SettingsButton(title: sl("Delete"), kind: .danger, disabled: busy, identifier: "settings.rule.delete") {
                    Task { if await library.deleteRule(id: id) { dismiss() } }
                }
            }
        }
        .padding(FlintMetrics.Space.s4)
        .padding(.top, FlintMetrics.Space.s2)
    }
}

private struct ConditionEditor: View {
    @Binding var condition: RuleCondition
    let index: Int
    let issue: String?
    let onRemove: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            SettingsChoiceRow(
                title: sl("Field"), selection: Binding(get: { condition.field }, set: { condition = RuleDraft.with(field: $0, on: condition) }),
                choices: RuleDraft.fields.map { (value: $0, label: RuleDraft.label($0)) }, identifier: "settings.rule.condition.\(index).field")
            SettingsChoiceRow(
                title: sl("Test"), selection: $condition.op,
                choices: RuleDraft.operators(for: condition.field).map { (value: $0, label: RuleDraft.label($0)) },
                identifier: "settings.rule.condition.\(index).op")
            if condition.op != .isTrue {
                SettingsField(label: sl("Value"), text: $condition.value, prompt: sl("Value"), invalid: issue != nil, identifier: "settings.rule.condition.\(index).value")
                SettingsFieldError(message: issue)
            }
            removeButton(sl("Remove condition"), id: "settings.rule.condition.\(index).remove", action: onRemove)
        }
    }
}

private struct ActionEditor: View {
    @Binding var action: RuleAction
    let index: Int
    let accountId: AccountID?
    let issue: String?
    let onRemove: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            SettingsChoiceRow(
                title: sl("Action"),
                selection: Binding(get: { RuleDraft.kind(of: action) }, set: { action = RuleDraft.newAction($0) }),
                choices: RuleDraft.ActionKind.allCases.map { (value: $0, label: RuleDraft.label($0)) }, identifier: "settings.rule.action.\(index).kind")
            parameter
            removeButton(sl("Remove action"), id: "settings.rule.action.\(index).remove", action: onRemove)
        }
    }

    @ViewBuilder private var parameter: some View {
        switch action {
        case .move(let path):
            SettingsField(
                label: sl("Folder"), text: Binding(get: { path }, set: { action = .move(folderPath: $0) }), prompt: sl("Folder name"),
                invalid: issue != nil, identifier: "settings.rule.action.\(index).folder")
            SettingsFieldError(message: issue)
        case .category(let category):
            SettingsChoiceRow(
                title: sl("Category"), selection: Binding(get: { category }, set: { action = .category($0) }),
                choices: MailCategory.allCases.map { (value: $0, label: RuleDraft.label($0)) }, identifier: "settings.rule.action.\(index).category")
        case .notify(let on):
            SettingsChoiceRow(
                title: sl("Notification"), selection: Binding(get: { on }, set: { action = .notify(enabled: $0) }),
                choices: [(value: true, label: sl("Notify me")), (value: false, label: sl("Stay quiet"))], identifier: "settings.rule.action.\(index).notify")
        default:
            EmptyView()
        }
    }
}

private func removeButton(_ title: String, id: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
        SettingsRowLayout(icon: .close, title: title, titleColor: FlintColor.fg3) { EmptyView() }.contentShape(Rectangle())
    }
    .buttonStyle(FlintPressStyle(radius: 0))
    .accessibilityIdentifier(id)
}

extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
