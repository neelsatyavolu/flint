import FlintPairing
import SwiftUI
import UIKit

private func pl(_ key: String.LocalizationValue) -> String { PairingText.pl(key) }

/// Page chrome shared by the simple steps: a scrolling column, 520 pt wide at most.
struct PairingColumn<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FlintMetrics.Space.s6) { content }
                .frame(maxWidth: 520, alignment: .leading)
                .padding(.horizontal, FlintMetrics.Space.s4)
                .padding(.vertical, FlintMetrics.Space.s6)
                .frame(maxWidth: .infinity)
        }
    }
}

struct PairingIntroStep: View {
    let model: PairingModel

    var body: some View {
        PairingColumn {
            VStack(alignment: .leading, spacing: FlintMetrics.Space.s2) {
                FlintIconView(icon: .smartphone, size: 28, color: FlintColor.accent)
                Text(pl("Bring your accounts from your Mac")).flintText(.compose)
                    .accessibilityAddTraits(.isHeader).accessibilityIdentifier("pairing.intro.title")
                Text(pl("Your Mac sends accounts, signatures, templates, rules and blocked senders straight to this iPhone over Wi-Fi.")).flintText(.message, color: FlintColor.fg3)
            }
            VStack(alignment: .leading, spacing: FlintMetrics.Space.s3) {
                stepLine("1", pl("On your Mac, open Flint, then Settings > Devices, then Show code."))
                stepLine("2", pl("Scan the code here."))
                stepLine("3", pl("Compare the six digits on both screens, then approve on your Mac."))
            }
            Text(pl("Flint asks to use the camera and to find devices on your local network. Choose Allow for both. Google accounts arrive as Sign in rows because Google logins can't be copied."))
                .flintText(.body, color: FlintColor.fg3)
            VStack(spacing: FlintMetrics.Space.s2) {
                Button(pl("Scan code")) { model.showScanner() }
                    .buttonStyle(FlintButtonStyle(kind: .primary)).frame(maxWidth: .infinity)
                    .accessibilityIdentifier("pairing.scan")
                if model.offersDemoMac {
                    Button(pl("Use a demo Mac")) { model.useDemoMac() }
                        .buttonStyle(FlintButtonStyle(kind: .ghost)).frame(maxWidth: .infinity)
                        .accessibilityIdentifier("pairing.demo")
                }
            }
        }
    }

    private func stepLine(_ number: String, _ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: FlintMetrics.Space.s3) {
            Text(number).flintText(.label, color: FlintColor.accent).frame(width: 16, alignment: .leading)
            Text(text).flintText(.message).frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}

struct PairingScanStep: View {
    let model: PairingModel
    @State private var camera = CameraAccess.current

    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                if camera == .allowed, QRScannerView.isSupported {
                    QRScannerView { model.handle(scanned: $0) }
                        .accessibilityIdentifier("pairing.scanner")
                } else {
                    unavailable
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(FlintColor.plane0)
            Text(pl("Point the camera at the code on your Mac."))
                .flintText(.message).frame(maxWidth: .infinity).padding(FlintMetrics.Space.s4)
                .accessibilityIdentifier("pairing.scan.hint")
        }
        .task { camera = await CameraAccess.request() }
    }

    private var unavailable: some View {
        VStack(spacing: FlintMetrics.Space.s4) {
            FlintIconView(icon: .qrCode, size: 32, color: FlintColor.fg3)
            Text(unavailableText).flintText(.message, color: FlintColor.fg2).multilineTextAlignment(.center)
                .accessibilityIdentifier("pairing.scan.unavailable")
            if camera == .denied {
                Button(pl("Open Settings")) { UIApplication.openSettings() }
                    .buttonStyle(FlintButtonStyle(kind: .secondary)).accessibilityIdentifier("pairing.openSettings")
            }
            if model.offersDemoMac {
                Button(pl("Use a demo Mac")) { model.useDemoMac() }
                    .buttonStyle(FlintButtonStyle(kind: .primary)).accessibilityIdentifier("pairing.demo")
            }
        }
        .padding(FlintMetrics.Space.s6)
    }

    private var unavailableText: String {
        switch camera {
        case .denied: pl("Camera access is off for Flint. Turn it on in Settings, or scan the code with the Camera app, which opens Flint.")
        case .undetermined: pl("Waiting for camera access…")
        case .allowed: pl("This device can't scan codes. Scan it with the Camera app, which opens Flint.")
        }
    }
}

/// A pairing link was opened from outside the app. Show where it points and let the person decide.
struct PairingLinkConfirmStep: View {
    let hosts: String
    let connect: () -> Void
    let cancel: () -> Void

    var body: some View {
        PairingColumn {
            VStack(alignment: .leading, spacing: FlintMetrics.Space.s2) {
                FlintIconView(icon: .smartphone, size: 28, color: FlintColor.accent)
                Text(pl("Pair with the Mac showing this code?")).flintText(.compose)
                    .accessibilityAddTraits(.isHeader).accessibilityIdentifier("pairing.link.title")
                Text(pl("This link points to")).flintText(.label, color: FlintColor.fg3)
                Text(hosts).flintText(.data).accessibilityIdentifier("pairing.link.hosts")
            }
            Text(pl("Only continue if you opened this link by scanning the code on your own Mac. A link from a web page or a message can point somewhere else. Flint will show six digits to compare with your Mac before anything is sent."))
                .flintText(.message, color: FlintColor.fg2)
            VStack(spacing: FlintMetrics.Space.s2) {
                Button(pl("Connect"), action: connect)
                    .buttonStyle(FlintButtonStyle(kind: .primary)).frame(maxWidth: .infinity)
                    .accessibilityIdentifier("pairing.link.connect")
                Button(pl("Cancel"), action: cancel)
                    .buttonStyle(FlintButtonStyle(kind: .ghost)).frame(maxWidth: .infinity)
                    .accessibilityIdentifier("pairing.link.cancel")
            }
        }
    }
}

struct PairingConnectingStep: View {
    var text = PairingText.pl("Connecting to your Mac…")

    var body: some View {
        VStack(spacing: FlintMetrics.Space.s4) {
            ProgressView().tint(FlintColor.fg3)
            Text(text).flintText(.message).accessibilityIdentifier("pairing.connecting")
            Text(pl("If iOS asks to find devices on your local network, choose Allow.")).flintText(.body, color: FlintColor.fg3)
                .multilineTextAlignment(.center)
        }
        .padding(FlintMetrics.Space.s6)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// The six digits to compare with the Mac, while the Mac's owner decides.
struct PairingCodeStep: View {
    let digits: String
    let cancel: () -> Void

    var body: some View {
        PairingColumn {
            VStack(alignment: .leading, spacing: FlintMetrics.Space.s2) {
                Text(pl("Code")).flintText(.label, color: FlintColor.fg3)
                Text(digits)
                    .font(.custom("GeistMono-Medium", size: 44, relativeTo: .largeTitle))
                    .foregroundStyle(FlintColor.fg)
                    .monospacedDigit()
                    .accessibilityLabel(pl("Code") + " " + digits.map(String.init).joined(separator: " "))
                    .accessibilityIdentifier("pairing.code")
            }
            Text(pl("Your Mac shows the same six digits. If they differ, cancel: someone else may be connecting.")).flintText(.message)
            HStack(spacing: FlintMetrics.Space.s3) {
                ProgressView().controlSize(.small).tint(FlintColor.fg3)
                Text(pl("Waiting for you to approve on your Mac…")).flintText(.body, color: FlintColor.fg3)
            }
            .accessibilityElement(children: .combine)
            Button(pl("Cancel"), action: cancel)
                .buttonStyle(FlintButtonStyle(kind: .ghost)).frame(maxWidth: .infinity)
                .accessibilityIdentifier("pairing.cancel")
        }
    }
}

struct PairingFailedStep: View {
    let failure: PairingModel.PairingFailure
    let retry: () -> Void

    var body: some View {
        PairingColumn {
            OnboardingNotice(tone: .danger, text: failure.message, identifier: "pairing.error")
            if failure.opensSettings {
                Button(pl("Open Settings")) { UIApplication.openSettings() }
                    .buttonStyle(FlintButtonStyle(kind: .secondary)).frame(maxWidth: .infinity)
                    .accessibilityIdentifier("pairing.openSettings")
            }
            Button(pl("Try again"), action: retry)
                .buttonStyle(FlintButtonStyle(kind: .primary)).frame(maxWidth: .infinity)
                .accessibilityIdentifier("pairing.retry")
            Text(pl("You can also add accounts one by one from Settings > Accounts.")).flintText(.body, color: FlintColor.fg3)
        }
    }
}

extension UIApplication {
    @MainActor static func openSettings() {
        if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
    }
}
