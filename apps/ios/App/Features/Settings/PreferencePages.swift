import FlintModel
import SwiftUI

/// Theme, density and list look.
struct AppearancePage: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @State private var theme = FlintAppearance.system

    var body: some View {
        SettingsPage(title: sl("Appearance"), identifier: "appearance") {
            SettingsGroup(title: sl("Theme")) {
                SettingsChoiceRow(
                    icon: .sliders, title: sl("Theme"), detail: String(format: sl("Graphite is dark, Paper is light. System follows your %@."), ThisDevice.name),
                    selection: themeBinding, choices: FlintAppearance.allCases.map { (value: $0, label: $0.title) }, identifier: "settings.appearance.theme")
                SettingsRowLayout(icon: .eye, title: sl("Text size"), detail: sl("Flint follows the text size set in the iOS Settings app, including larger accessibility sizes.")) {
                    Button { openSystemSettings() } label: { Text("Open Settings", tableName: "Settings") }
                        .buttonStyle(FlintButtonStyle(kind: .ghost))
                        .accessibilityIdentifier("settings.appearance.openSystem")
                }
            }
            SettingsGroup(title: sl("Mail list")) {
                SettingsChoiceRow(
                    title: sl("Density"), selection: model.choiceSetting({ $0.appearance.density }, section: "appearance", key: "density"),
                    choices: [(value: Settings.Appearance.Density.comfortable, label: sl("Comfortable")), (value: .compact, label: sl("Compact"))],
                    identifier: "settings.appearance.density")
                SettingsChoiceRow(
                    title: sl("Preview lines"),
                    selection: model.settingBinding({ $0.appearance.previewLines }, section: "appearance", key: "previewLines", encode: { .number(Double($0)) }),
                    choices: [(value: 0, label: sl("None")), (value: 1, label: sl("1 line")), (value: 2, label: sl("2 lines"))],
                    identifier: "settings.appearance.previewLines")
                SettingsChoiceRow(
                    title: sl("Avatars"), selection: model.choiceSetting({ $0.appearance.avatars }, section: "appearance", key: "avatars"),
                    choices: [(value: Settings.Appearance.Avatars.everywhere, label: sl("Everywhere")), (value: .list, label: sl("In the list")), (value: .off, label: sl("Off"))],
                    identifier: "settings.appearance.avatars")
                SettingsToggleRow(
                    title: sl("Account colors"), detail: sl("Mark each account's mail with its color in combined lists."),
                    isOn: model.boolSetting({ $0.appearance.accountColors }, section: "appearance", key: "accountColors"), identifier: "settings.appearance.accountColors")
            }
            SettingsGroup(title: sl("Reading")) {
                SettingsChoiceRow(
                    title: sl("Mail in Graphite"), detail: sl("Adapt message colors to the dark theme, or show the sender's original white page."),
                    selection: model.choiceSetting({ $0.appearance.emailAppearance }, section: "appearance", key: "emailAppearance"),
                    choices: [(value: Settings.Appearance.EmailAppearance.match, label: sl("Match theme")), (value: .light, label: sl("Original"))],
                    identifier: "settings.appearance.emailAppearance")
            }
        }
        .onAppear { theme = FlintAppearance(rawValue: model.defaults.string(forKey: FlintAppearance.defaultsKey) ?? "") ?? .system }
    }

    private var themeBinding: Binding<FlintAppearance> {
        Binding(
            get: { theme },
            set: { value in
                theme = value
                model.defaults.set(value.rawValue, forKey: FlintAppearance.defaultsKey)
                // Keep the shared setting in step so a paired Mac reads the same choice.
                Task { await model.updateSettings(patch: SettingsPatch.object("appearance", "theme", .string(value.rawValue))) }
            })
    }

    private func openSystemSettings() {
        if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
    }
}

/// Smart inbox, ordering and swipe actions.
struct InboxPage: View {
    @Environment(AppModel.self) private var model
    @State private var swipes = SwipeConfiguration.standard

    var body: some View {
        SettingsPage(title: sl("Inbox"), identifier: "inbox") {
            SettingsGroup(title: sl("Smart inbox"), note: sl("Smart inbox keeps mail from people in the list and folds notifications and newsletters into bundles.")) {
                SettingsToggleRow(
                    icon: .inbox, title: sl("Smart inbox"), detail: sl("Show people first. Switch to all mail from the list header."),
                    isOn: model.boolSetting({ $0.inbox.focused }, section: "inbox", key: "focused"), identifier: "settings.inbox.smart")
                SettingsChoiceRow(
                    title: sl("Sort"), selection: model.choiceSetting({ $0.inbox.sort }, section: "inbox", key: "sort"),
                    choices: [(value: SortOrder.newest, label: sl("Newest first")), (value: .oldest, label: sl("Oldest first"))], identifier: "settings.inbox.sort")
                SettingsChoiceRow(
                    title: sl("Mark as read"), selection: model.choiceSetting({ $0.inbox.markReadOnOpen }, section: "inbox", key: "markReadOnOpen"),
                    choices: [
                        (value: Settings.Inbox.MarkReadOnOpen.instant, label: sl("When opened")), (value: .delay, label: sl("After a moment")),
                        (value: .never, label: sl("Never")),
                    ], identifier: "settings.inbox.markRead")
            }
            SettingsGroup(title: sl("Actions")) {
                SettingsChoiceRow(
                    title: sl("After archive"), detail: sl("What to show next when you archive an open conversation."),
                    selection: model.choiceSetting({ $0.inbox.afterArchive }, section: "inbox", key: "afterArchive"),
                    choices: [
                        (value: Settings.Inbox.AfterArchive.next, label: sl("Next conversation")), (value: .previous, label: sl("Previous conversation")),
                        (value: .list, label: sl("Back to the list")),
                    ], identifier: "settings.inbox.afterArchive")
                SettingsChoiceRow(
                    title: sl("Swipe right"), selection: swipe(.leading), choices: swipeChoices,
                    identifier: "settings.inbox.swipeLeading")
                SettingsChoiceRow(
                    title: sl("Swipe left"), selection: swipe(.trailing), choices: swipeChoices,
                    identifier: "settings.inbox.swipeTrailing")
            }
        }
        .onAppear { swipes = SwipeConfiguration.load(from: model.defaults) }
    }

    private var swipeChoices: [(value: SwipeAction?, label: String)] {
        ([nil] + SwipeAction.allCases.map(Optional.some)).map { (value: $0, label: SwipeConfiguration.choiceLabel($0)) }
    }

    private func swipe(_ side: SwipeConfiguration.Side) -> Binding<SwipeAction?> {
        Binding(get: { swipes.primary(side) }, set: { value in
            swipes = swipes.choosing(value, for: side)
            swipes.save(to: model.defaults)
        })
    }
}

/// Undo send and receipts default.
struct ComposePage: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        SettingsPage(title: sl("Composing"), identifier: "compose") {
            SettingsGroup(title: sl("Sending")) {
                SettingsChoiceRow(
                    icon: .undo, title: sl("Undo send"), detail: sl("How long you can take a message back after you tap Send."),
                    selection: model.settingBinding({ $0.compose.undoSendSeconds }, section: "compose", key: "undoSendSeconds", encode: { .number(Double($0)) }),
                    choices: SettingsChoices.undoSendSeconds.map { (value: $0, label: SettingsChoices.undoLabel($0)) }, identifier: "settings.compose.undoSend")
                SettingsToggleRow(
                    icon: .fileText, title: sl("Plain text only"), detail: sl("Send messages without formatting."),
                    isOn: model.boolSetting({ $0.compose.plainTextOnly }, section: "compose", key: "plainTextOnly"), identifier: "settings.compose.plainText")
            }
            SettingsGroup(title: sl("Read receipts")) {
                SettingsToggleRow(
                    icon: .eye, title: sl("Track new mail by default"), detail: sl("You can turn it off for a single message in the composer."),
                    isOn: model.boolSetting({ $0.receipts.defaultOn }, section: "receipts", key: "defaultOn"), identifier: "settings.compose.receiptsDefault",
                    disabled: !(model.settings?.receipts.enabled ?? true))
            }
            SettingsGroup(title: sl("Signatures")) {
                SettingsLinkRow(
                    icon: .pencil, title: sl("Signatures and templates"), destination: SettingsDestination.section(.signatures), identifier: "settings.compose.signatures")
            }
        }
    }
}

/// Read receipts switches. The per-message status lives on the Read receipts screen of the composer and thread (a later wave).
struct ReceiptsPage: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let enabled = model.settings?.receipts.enabled ?? true
        SettingsPage(title: sl("Read receipts"), identifier: "receipts") {
            SettingsGroup(title: sl("Read receipts"), note: sl("Know when a message you sent was opened, without false opens.")) {
                SettingsToggleRow(
                    icon: .eye, title: sl("Enable read receipts"),
                    isOn: model.boolSetting({ $0.receipts.enabled }, section: "receipts", key: "enabled"), identifier: "settings.receipts.enabled")
                SettingsToggleRow(
                    title: sl("Track new mail by default"), isOn: model.boolSetting({ $0.receipts.defaultOn }, section: "receipts", key: "defaultOn"),
                    identifier: "settings.receipts.defaultOn", disabled: !enabled)
                SettingsToggleRow(
                    icon: .bell, title: sl("Notify when opened"), isOn: model.boolSetting({ $0.receipts.notifyOnOpen }, section: "receipts", key: "notifyOnOpen"),
                    identifier: "settings.receipts.notify", disabled: !enabled)
            }
            Text("Opens from Apple Mail Privacy Protection can't be confirmed, so Flint says so instead of guessing.", tableName: "Settings")
                .flintText(.body, color: FlintColor.fg3).padding(FlintMetrics.Space.s4)
        }
    }
}

/// Notifications live in `Features/Notifications`.
struct NotificationsPage: View {
    var body: some View { NotificationsSettingsPage() }
}
