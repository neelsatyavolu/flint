import SwiftUI

/// Settings > Devices. The iPhone keeps no list of Macs: it remembers only the name and date of the last one.
struct DevicesPage: View {
    @Environment(AppModel.self) private var model
    @State private var showing = false

    var body: some View {
        SettingsPage(title: PairingText.pl("Devices"), identifier: "devices") {
            SettingsGroup(
                title: PairingText.pl("Mac"),
                note: PairingText.pl("Copy your accounts, signatures, templates, rules and blocked senders from Flint on your Mac. It goes over Wi-Fi and is encrypted; nothing passes through a server.")
            ) {
                Button { showing = true } label: {
                    SettingsRowLayout(icon: .smartphone, title: PairingText.pl("Set up from your Mac"), detail: lastDetail) {
                        FlintIconView(icon: .chevronRight, size: 16, color: FlintColor.fg4)
                    }
                }
                .buttonStyle(FlintPressStyle(radius: 0))
                .accessibilityIdentifier("devices.setup")
            }
            Text(PairingText.pl("Google accounts show up as Sign in rows because a Google login can't be copied between apps. Passwords come only if you tick that box on your Mac."))
                .flintText(.body, color: FlintColor.fg3)
                .padding(.horizontal, FlintMetrics.Space.s4).padding(.top, FlintMetrics.Space.s3)
        }
        .sheet(isPresented: $showing) {
            PairingFlow(model: PairingModel(services: model.pairingServices)) { _ in showing = false }
                .environment(model)
        }
    }

    private var lastDetail: String? {
        guard let last = PairedMacRecord.load(model.defaults) else { return nil }
        return PairingText.pl("Last: ") + last.name + ", " + last.pairedAt.formatted(date: .abbreviated, time: .omitted)
    }
}

extension AppModel {
    /// The demo Mac in a seeded demo, the real network otherwise.
    var pairingServices: any PairingServices { isDemo ? DemoPairingServices() : AppPairingServices(model: self) }
}
