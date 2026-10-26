import FlintModel
import SwiftUI

struct PrivacyPage: View {
    @Environment(AppModel.self) private var model
    @State private var lockOn = false
    @State private var lockUnavailable = false

    var body: some View {
        SettingsPage(title: sl("Privacy"), identifier: "privacy") {
            SettingsGroup(title: sl("Images"), note: sl("Images in mail load from the sender's server, which tells them you opened it.")) {
                SettingsChoiceRow(
                    icon: .image, title: sl("Remote images"), selection: model.choiceSetting({ $0.inbox.remoteImages }, section: "inbox", key: "remoteImages"),
                    choices: [
                        (value: Settings.Inbox.RemoteImages.never, label: sl("Never load")), (value: .knownSenders, label: sl("Known senders")),
                        (value: .always, label: sl("Always load")),
                    ], identifier: "settings.privacy.remoteImages")
                SettingsToggleRow(
                    icon: .shield, title: sl("Block trackers"), detail: sl("Remove known tracking pixels from incoming mail before it is shown."),
                    isOn: model.boolSetting({ $0.inbox.blockTrackers }, section: "inbox", key: "blockTrackers"), identifier: "settings.privacy.trackers")
            }
            SettingsGroup(title: sl("Lock")) {
                SettingsToggleRow(
                    icon: .lock, title: sl("Require Face ID"), detail: sl("Ask for Face ID or your passcode when you open Flint."),
                    isOn: Binding(get: { lockOn }, set: setLock), identifier: "settings.privacy.faceID")
                if lockUnavailable {
                    Text("Set a passcode in the iOS Settings app to use this.", tableName: "Settings")
                        .flintText(.body, color: FlintColor.danger).padding(.horizontal, FlintMetrics.Space.s4).padding(.top, FlintMetrics.Space.s2)
                        .accessibilityIdentifier("settings.privacy.faceID.unavailable")
                }
            }
            Text("Flint has no account and no analytics. Your mail is stored on this iPhone, and Flint talks only to your mail provider.", tableName: "Settings")
                .flintText(.body, color: FlintColor.fg3).padding(FlintMetrics.Space.s4)
        }
        .onAppear { lockOn = model.defaults.bool(forKey: SettingsDefaultsKey.faceIDLock) }
    }

    private func setLock(_ on: Bool) {
        guard on else {
            lockOn = false
            model.defaults.set(false, forKey: SettingsDefaultsKey.faceIDLock)
            return
        }
        guard FaceIDLock.isAvailable() else {
            lockUnavailable = true
            return
        }
        lockUnavailable = false
        Task {
            let confirmed = await FaceIDLock.confirm(reason: sl("Turn on the Flint lock"))
            lockOn = confirmed
            model.defaults.set(confirmed, forKey: SettingsDefaultsKey.faceIDLock)
        }
    }
}

struct AboutPage: View {
    static var version: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "0"
        let build = info?["CFBundleVersion"] as? String ?? "0"
        return "\(short) (\(build))"
    }

    var body: some View {
        SettingsPage(title: sl("About"), identifier: "about") {
            HStack(spacing: FlintMetrics.Space.s4) {
                FlintMark()
                    .stroke(FlintColor.fg2, style: StrokeStyle(lineWidth: 1.5, lineJoin: .round))
                    .frame(width: 40, height: 40)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Flint", tableName: "Settings").flintText(.title)
                    Text(String(format: sl("Version %@"), Self.version)).flintText(.data, color: FlintColor.fg3)
                        .accessibilityIdentifier("settings.about.version")
                }
            }
            .padding(FlintMetrics.Space.s4)
            .padding(.top, FlintMetrics.Space.s2)
            FlintHairline()
            SettingsRowLayout(title: sl("Free"), detail: sl("Flint is free. No account, no tracking of you.")) { EmptyView() }
            SettingsRowLayout(title: sl("License"), detail: sl("MIT. You can read, change and share the source on GitHub.")) { EmptyView() }
            SettingsRowLayout(title: sl("Your mail stays on this iPhone"), detail: sl("Mail is cached in a local database. Flint talks to your mail provider and nothing else.")) { EmptyView() }
            SettingsRowLayout(
                title: sl("Background"),
                detail: sl("iOS decides when Flint can check for mail in the background. Mail arrives right away while the app is open.")) { EmptyView() }
            SettingsLinkRow(icon: .fileText, title: sl("Licenses"), destination: SettingsDestination.licenses, identifier: "settings.about.licenses")
        }
    }
}

/// The open-source pieces Flint is built from.
struct LicensesView: View {
    private struct Item: Identifiable {
        let name: String
        let license: String
        let note: String
        var id: String { name }
    }

    private let items: [Item] = [
        Item(name: "Geist and Geist Mono", license: "SIL Open Font License 1.1", note: "Vercel"),
        Item(name: "Newsreader", license: "SIL Open Font License 1.1", note: "Production Type"),
        Item(name: "Lucide", license: "ISC", note: "Icons"),
        Item(name: "SwiftMail", license: "BSD", note: "IMAP and SMTP"),
        Item(name: "GRDB.swift", license: "MIT", note: "Local database"),
        Item(name: "SwiftSoup", license: "MIT", note: "HTML cleaning"),
        Item(name: "SwiftNIO, swift-crypto and other Apple Swift packages", license: "Apache 2.0", note: "Networking and cryptography"),
    ]

    var body: some View {
        SettingsPage(title: sl("Licenses"), identifier: "licenses") {
            Text("Flint is MIT licensed and is built from these open-source projects.", tableName: "Settings")
                .flintText(.body, color: FlintColor.fg3).padding(FlintMetrics.Space.s4)
            FlintHairline()
            ForEach(items) { item in
                SettingsRowLayout(title: item.name, detail: "\(item.license) · \(item.note)") { EmptyView() }
                    .accessibilityElement(children: .combine)
            }
        }
    }
}
