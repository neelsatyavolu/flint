import FlintModel
import SwiftUI

/// Settings > Notifications: the permission, what alerts say, per-account switches, verification codes, and the background
/// checks with their diagnostics so the real cadence can be measured.
struct NotificationsSettingsPage: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @State private var checking = false

    private var notifications: Settings.Notifications { model.settings?.notifications ?? Settings.Notifications() }

    var body: some View {
        SettingsPage(title: nl("Notifications"), identifier: "notifications") {
            permissionGroup
            alertsGroup
            accountsGroup
            codesGroup
            BackgroundChecksGroup(checking: $checking)
        }
        .task { await model.notifications.refreshAuthorization() }
    }

    // MARK: Permission

    private var permissionGroup: some View {
        SettingsGroup(title: nl("Permission")) {
            switch model.notifications.authorization {
            case .allowed:
                SettingsRowLayout(icon: .bell, title: nl("Notifications are on"), detail: nl("Flint can alert you to new mail and to verification codes.")) {
                    EmptyView()
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("settings.notifications.status.allowed")
            case .notDetermined:
                SettingsRowLayout(icon: .bell, title: nl("Notifications are off"), detail: nl("Flint asks once. Alerts for people and codes need your OK.")) {
                    Button { Task { await model.notifications.requestPermission() } } label: { Text(nl("Turn on")) }
                        .buttonStyle(FlintButtonStyle(kind: .primary))
                        .accessibilityIdentifier("settings.notifications.allow")
                }
            case .denied:
                SettingsRowLayout(icon: .bell, title: nl("Blocked in iOS Settings"), detail: nl("Turn Flint's notifications back on in the Settings app.")) {
                    Button { openSystemSettings() } label: { Text(nl("Open Settings")) }
                        .buttonStyle(FlintButtonStyle(kind: .ghost))
                        .accessibilityIdentifier("settings.notifications.openSystem")
                }
            }
        }
    }

    // MARK: Alerts

    private var alertsGroup: some View {
        SettingsGroup(title: nl("Alerts")) {
            SettingsToggleRow(
                title: nl("Alert me to new mail"), isOn: model.boolSetting({ $0.notifications.enabled }, section: "notifications", key: "enabled"),
                identifier: "settings.notifications.enabled")
            SettingsChoiceRow(
                title: nl("Mail to alert for"), selection: model.choiceSetting({ $0.notifications.scope }, section: "notifications", key: "scope"),
                choices: [(value: Settings.Notifications.Scope.people, label: nl("People only")), (value: .all, label: nl("All mail")), (value: .none, label: nl("None"))],
                identifier: "settings.notifications.scope")
            SettingsChoiceRow(
                title: nl("Preview"), selection: model.choiceSetting({ $0.notifications.preview }, section: "notifications", key: "preview"),
                choices: [
                    (value: Settings.Notifications.Preview.senderSubject, label: nl("Sender and subject")),
                    (value: .senderSubjectLine, label: nl("Sender, subject and first line")), (value: .none, label: nl("Hidden")),
                ], identifier: "settings.notifications.preview")
            SettingsToggleRow(
                title: nl("Sound"), isOn: model.boolSetting({ $0.notifications.sound }, section: "notifications", key: "sound"),
                identifier: "settings.notifications.sound")
            SettingsChoiceRow(
                title: nl("App badge"), selection: model.choiceSetting({ $0.notifications.badge }, section: "notifications", key: "badge"),
                choices: [(value: Settings.Notifications.Badge.unifiedUnread, label: nl("Inbox unread")), (value: .off, label: nl("Off"))],
                identifier: "settings.notifications.badge")
        }
        .opacity(notifications.enabled ? 1 : 0.9)
    }

    private var accountsGroup: some View {
        SettingsGroup(title: nl("Accounts"), note: nl("Choose which accounts can alert you.")) {
            ForEach(model.accounts) { account in
                SettingsToggleRow(
                    title: account.email, isOn: accountBinding(account.id), identifier: "settings.notifications.account.\(account.id)",
                    disabled: !notifications.enabled)
            }
        }
    }

    private func accountBinding(_ id: AccountID) -> Binding<Bool> {
        Binding(
            get: { !notifications.disabledAccounts.contains(id) },
            set: { enabled in
                let next = NotificationsText.disabledAccounts(notifications.disabledAccounts, toggling: id, enabled: enabled)
                let patch = SettingsPatch.object("notifications", "disabledAccounts", .array(next.map { .string($0) }))
                Task { await model.updateSettings(patch: patch) }
            })
    }

    // MARK: Codes

    private var codesGroup: some View {
        SettingsGroup(title: nl("Verification codes")) {
            SettingsToggleRow(
                title: nl("Find verification codes"), detail: nl("Codes from new mail show above your inbox for ten minutes."),
                isOn: model.boolSetting({ $0.codes.enabled }, section: "codes", key: "enabled"), identifier: "settings.codes.enabled")
            SettingsToggleRow(
                title: nl("Alert for codes"), detail: nl("The alert reads the service and the code. Copy code is a button on it."),
                isOn: model.boolSetting({ $0.codes.notify }, section: "codes", key: "notify"), identifier: "settings.codes.notify",
                disabled: !(model.settings?.codes.enabled ?? true))
            SettingsToggleRow(
                title: nl("Copy new codes automatically"), detail: nl("Only while Flint is open. The copy is dropped after a minute."),
                isOn: model.boolSetting({ $0.codes.autoCopy }, section: "codes", key: "autoCopy"), identifier: "settings.codes.autoCopy",
                disabled: !(model.settings?.codes.enabled ?? true))
        }
    }

    private func openSystemSettings() {
        if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
    }
}
