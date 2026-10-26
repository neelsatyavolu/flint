import FlintModel
import LocalAuthentication
import SwiftUI

/// Checks and asks for Face ID (or the passcode) before the lock is turned on, so a person cannot lock themselves out.
enum FaceIDLock {
    static func isAvailable() -> Bool {
        LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
    }

    static func confirm(reason: String) async -> Bool {
        let context = LAContext()
        return (try? await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)) ?? false
    }
}

/// What Flint contacts, in plain words. Every line here is something the app does; `PrivacyCopyTests` keeps the list honest.
enum PrivacyCopy {
    static var contacts: String {
        sl("Flint talks to your mail provider. When you sign in with Google it also talks to Google. When you add an account it asks the Thunderbird settings database for your provider's server settings and sends it the domain of your address. If you turn on read receipts, tracked messages point to the receipts address you set. Images load from the sender's server only when you allow them.")
    }

    static var cached: String {
        sl("Mail is cached in a local database. The only other contacts are the ones listed under Privacy.")
    }
}

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
            Text(String(format: sl("Flint has no account and no analytics. Your mail is stored on this %@."), ThisDevice.name))
                .flintText(.body, color: FlintColor.fg3).padding(.horizontal, FlintMetrics.Space.s4).padding(.top, FlintMetrics.Space.s4)
                .accessibilityIdentifier("settings.privacy.stored")
            Text(PrivacyCopy.contacts)
                .flintText(.body, color: FlintColor.fg3).padding(FlintMetrics.Space.s4)
                .accessibilityIdentifier("settings.privacy.contacts")
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
            SettingsRowLayout(title: String(format: sl("Your mail stays on this %@"), ThisDevice.name), detail: PrivacyCopy.cached) { EmptyView() }
            SettingsRowLayout(
                title: sl("Background"),
                detail: sl("iOS decides when Flint can check for mail in the background. Mail arrives right away while the app is open.")) { EmptyView() }
            SettingsLinkRow(icon: .fileText, title: sl("Licenses"), destination: SettingsDestination.licenses, identifier: "settings.about.licenses")
        }
    }
}
