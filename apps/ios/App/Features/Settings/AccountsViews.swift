import FlintModel
import SwiftUI

/// The accounts group on the Settings root and on the Accounts page: one row per account, then "Add account".
struct AccountsGroup: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        SettingsGroup(title: sl("Accounts")) {
            ForEach(model.accounts) { account in
                AccountRow(account: account)
            }
            Button { model.navigate(to: .onboarding) } label: {
                SettingsRowLayout(icon: .plus, title: sl("Add account")) { EmptyView() }
                    .contentShape(Rectangle())
            }
            .buttonStyle(FlintPressStyle(radius: 0))
            .accessibilityIdentifier("settings.addAccount")
        }
    }
}

private struct AccountRow: View {
    @Environment(AppModel.self) private var model
    let account: Account

    var body: some View {
        let status = AccountStatus.describe(sync: model.syncStatus(for: account.id), enabled: account.enabled)
        NavigationLink(value: SettingsDestination.account(account.id)) {
            HStack(spacing: FlintMetrics.Space.s3) {
                FlintAvatar(address: account.email, name: account.name, size: .s32)
                VStack(alignment: .leading, spacing: 2) {
                    Text(account.name.isEmpty ? account.email : account.name).flintText(.bodyMedium)
                    Text(account.email).flintText(.data, color: FlintColor.fg3)
                    Text(status.text).flintText(.data, color: AccountStatusColor.color(status.tone))
                }
                Spacer(minLength: FlintMetrics.Space.s2)
                if let hex = account.color {
                    Circle().fill(AccountPalette.color(hex: hex)).frame(width: 10, height: 10).accessibilityHidden(true)
                }
                FlintIconView(icon: .chevronRight, size: 16, color: FlintColor.fg3)
            }
            .padding(.horizontal, FlintMetrics.Space.s4)
            .padding(.vertical, FlintMetrics.Space.s3)
            .frame(maxWidth: .infinity, minHeight: FlintMetrics.Size.rowCompact, alignment: .leading)
            .overlay(alignment: .bottom) { FlintHairline() }
            .contentShape(Rectangle())
        }
        .buttonStyle(FlintPressStyle(radius: 0))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(account.name.isEmpty ? account.email : account.name), \(account.email), \(status.text)")
        .accessibilityIdentifier("settings.account.\(account.id)")
    }
}

struct AccountsPage: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        SettingsPage(title: sl("Accounts"), identifier: "accounts") {
            Text("Mail accounts Flint syncs. Changes apply at once.", tableName: "Settings")
                .flintText(.body, color: FlintColor.fg3)
                .padding(FlintMetrics.Space.s4)
            AccountsGroup()
            SettingsGroup(title: sl("Sync")) {
                SettingsChoiceRow(
                    icon: .clock, title: String(format: sl("Mail kept on this %@"), ThisDevice.name),
                    detail: sl("How far back Flint downloads when an account first syncs, for every account. Older mail loads when you reach the end of a list or search."),
                    selection: model.settingBinding({ $0.sync.initialDays }, section: "sync", key: "initialDays", encode: { .number(Double($0)) }),
                    choices: SettingsChoices.syncDays.map { (value: $0, label: SettingsChoices.syncLabel($0)) }, identifier: "settings.accounts.syncWindow")
            }
        }
    }
}

/// Eight swatches with 44 pt hit targets. The selected one has a ring and a check.
struct ColorSwatches: View {
    let current: String?
    let label: String
    let onPick: (String) -> Void

    private let columns = [GridItem(.adaptive(minimum: FlintMetrics.Size.touch), spacing: FlintMetrics.Space.s2)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: FlintMetrics.Space.s2) {
            ForEach(AccountPalette.hex, id: \.self) { hex in
                let selected = AccountPalette.isSelected(hex, current: current)
                Button { onPick(hex) } label: {
                    ZStack {
                        Circle().fill(AccountPalette.color(hex: hex)).frame(width: 32, height: 32)
                        if selected {
                            Circle().stroke(FlintColor.fg, lineWidth: 2).frame(width: 42, height: 42)
                            FlintIconView(icon: .check, size: 16, color: FlintColor.avatarFg)
                        }
                    }
                    .frame(width: FlintMetrics.Size.touch, height: FlintMetrics.Size.touch)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(label)
                .accessibilityValue(selected ? sl("Selected") : "")
                .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
                .accessibilityIdentifier("settings.color.\(hex.dropFirst())")
            }
        }
        .padding(.horizontal, FlintMetrics.Space.s4)
        .padding(.vertical, FlintMetrics.Space.s2)
    }
}

/// Aliases the account can send from: a removable list and an add field.
struct AliasEditor: View {
    let own: String
    let aliases: [String]
    let onChange: ([String]) -> Void
    @State private var draft = ""
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(aliases, id: \.self) { alias in
                SettingsRowLayout(title: alias) {
                    FlintIconButton(icon: .close, label: String(format: sl("Remove %@"), alias), identifier: "settings.alias.remove.\(alias)") {
                        onChange(aliases.filter { $0 != alias })
                    }
                }
            }
            HStack(alignment: .bottom, spacing: FlintMetrics.Space.s2) {
                SettingsField(label: sl("Add alias"), text: $draft, prompt: sl("name@example.com"), keyboard: .emailAddress, invalid: error != nil, identifier: "settings.alias.field")
                    .onSubmit(add)
                    .submitLabel(.done)
                Button(action: add) { Text("Add", tableName: "Settings") }
                    .buttonStyle(FlintButtonStyle(kind: .ghost))
                    .padding(.trailing, FlintMetrics.Space.s4)
                    .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
                    .accessibilityIdentifier("settings.alias.add")
            }
            SettingsFieldError(message: error)
        }
    }

    private func add() {
        switch AliasCheck.check(draft, own: own, existing: aliases) {
        case .failure(let message): error = message
        case .ok(let value):
            error = nil
            draft = ""
            onChange(aliases + [value])
        }
    }
}
