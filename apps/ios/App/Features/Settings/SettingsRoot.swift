import FlintModel
import SwiftUI

/// Where a Settings screen can push to.
enum SettingsDestination: Hashable {
    case section(SettingsSection)
    case account(AccountID)
    /// A signature to edit; nil starts a new one.
    case signature(Int?)
    case templates
    case template(Int?)
    case rule(Int?)
    case blocked
    case licenses
    /// One project's copyright line and license text, by its name in `ThirdPartyLicenses.json`.
    case license(String)
}

/// Settings, presented as a sheet for `Route.settings(section)`. The root lists the accounts and every page.
struct SettingsRoot: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        SettingsHost(model: model)
    }
}

private struct SettingsHost: View {
    @Environment(AppModel.self) private var model
    @State private var library: SettingsLibrary
    @State private var path: [SettingsDestination] = []

    init(model: AppModel) {
        _library = State(initialValue: SettingsLibrary(model: model))
    }

    var body: some View {
        NavigationStack(path: $path) {
            SettingsIndex()
                .toolbar(.hidden, for: .navigationBar)
                .navigationDestination(for: SettingsDestination.self) { SettingsDestinationView(destination: $0) }
        }
        .environment(library)
        .background(FlintColor.plane1.ignoresSafeArea())
        .task {
            if case .settings(let section)? = model.presented, section != .root, path.isEmpty {
                var transaction = Transaction()
                transaction.disablesAnimations = true
                withTransaction(transaction) { path = [.section(section)] }
            }
            await library.load()
        }
        .accessibilityIdentifier("settings.root")
    }
}

private struct SettingsIndex: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 0) {
            SheetHeader(title: sl("Settings"), identifier: "settings") { model.navigate(to: .dismiss) }
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    AccountsGroup()
                    SettingsGroup(title: sl("Preferences")) {
                        link(.appearance, icon: .sliders, title: sl("Appearance"), detail: appearanceName)
                        link(.inbox, icon: .inbox, title: sl("Inbox"))
                        link(.compose, icon: .compose, title: sl("Composing"))
                        link(.signatures, icon: .pencil, title: sl("Signatures and templates"))
                        link(.rules, icon: .tag, title: sl("Rules and blocked senders"))
                        link(.notifications, icon: .bell, title: sl("Notifications"))
                        link(.privacy, icon: .shield, title: sl("Privacy"))
                        link(.receipts, icon: .eye, title: sl("Read receipts"))
                        link(.devices, icon: .smartphone, title: PairingText.pl("Devices"))
                    }
                    SettingsGroup(title: sl("Flint")) {
                        link(.about, icon: .fileText, title: sl("About"))
                    }
                }
                .padding(.bottom, FlintMetrics.Space.s12)
                .frame(maxWidth: 640, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
        }
        .background(FlintColor.plane1.ignoresSafeArea())
    }

    private var appearanceName: String {
        FlintAppearance.resolved(stored: model.defaults.string(forKey: FlintAppearance.defaultsKey) ?? "").title
    }

    private func link(_ section: SettingsSection, icon: FlintIcon, title: String, detail: String? = nil) -> some View {
        SettingsLinkRow(icon: icon, title: title, value: detail, destination: SettingsDestination.section(section), identifier: "settings.section.\(section.rawValue)")
    }
}

private struct SettingsDestinationView: View {
    let destination: SettingsDestination

    var body: some View {
        switch destination {
        case .section(let section): SettingsSectionView(section: section)
        case .account(let id): AccountDetailView(accountId: id)
        case .signature(let id): SignatureEditorView(signatureId: id)
        case .templates: TemplatesView()
        case .template(let id): TemplateEditorView(templateId: id)
        case .rule(let id): RuleEditorView(ruleId: id)
        case .blocked: BlockedSendersView()
        case .licenses: LicensesView()
        case .license(let name): LicenseDetailView(name: name)
        }
    }
}

private struct SettingsSectionView: View {
    let section: SettingsSection

    var body: some View {
        switch section {
        case .root, .accounts: AccountsPage()
        case .appearance: AppearancePage()
        case .inbox: InboxPage()
        case .compose: ComposePage()
        case .signatures: SignaturesPage()
        case .rules: RulesPage()
        case .notifications: NotificationsPage()
        case .privacy: PrivacyPage()
        case .receipts: ReceiptsPage()
        case .devices: DevicesPage()
        case .about: AboutPage()
        }
    }
}
