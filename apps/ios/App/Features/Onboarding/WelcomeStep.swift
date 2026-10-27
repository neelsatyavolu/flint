import SwiftUI

/// First screen: three ways in. "Set up from your Mac" opens the pairing flow (Features/Pairing).
struct WelcomeStep: View {
    @Bindable var model: OnboardingModel
    let hasAccounts: Bool
    @Environment(AppModel.self) private var appModel
    @State private var pairing = false
    @State private var linkPayload: String?

    var body: some View {
        VStack(alignment: .leading, spacing: FlintMetrics.Space.s6) {
            VStack(alignment: .leading, spacing: FlintMetrics.Space.s2) {
                FlintIconView(icon: .mail, size: 28, color: FlintColor.accent)
                Text(hasAccounts ? String(localized: "Add another account", table: "Onboarding") : String(localized: "Add your email", table: "Onboarding"))
                    .flintText(.compose)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("onboarding.welcome.title")
                Text("Mail stays on this phone. Flint has no server.", tableName: "Onboarding")
                    .flintText(.message, color: FlintColor.fg3)
                    .accessibilityIdentifier("onboarding.welcome.privacy")
            }
            VStack(spacing: 0) {
                OnboardingChoiceRow(
                    icon: .user, title: String(localized: "Continue with Google", table: "Onboarding"),
                    detail: String(localized: "Sign in with your Google account", table: "Onboarding"),
                    identifier: "onboarding.google", isBusy: model.busy == .google) {
                        Task { await model.continueWithGoogle() }
                    }
                FlintHairline()
                OnboardingChoiceRow(
                    icon: .mail, title: String(localized: "Other email", table: "Onboarding"),
                    detail: String(localized: "iCloud, Fastmail, Yahoo or any IMAP server", table: "Onboarding"),
                    identifier: "onboarding.other") { model.show(.otherEmail) }
                FlintHairline()
                OnboardingChoiceRow(
                    icon: .smartphone, title: String(localized: "Set up from your Mac", table: "Onboarding"),
                    detail: String(localized: "Copy your accounts over Wi-Fi", table: "Onboarding"),
                    identifier: "onboarding.mac") { pairing = true }
            }
            .disabled(model.busy == .google)
            .overlay { RoundedRectangle(cornerRadius: FlintMetrics.Radius.card).stroke(FlintColor.line, lineWidth: 1) }
            .clipShape(RoundedRectangle(cornerRadius: FlintMetrics.Radius.card))
            if let text = model.errorText {
                OnboardingNotice(tone: .danger, text: text, identifier: "onboarding.error")
            }
        }
        .task { takePairLink() }
        .onChange(of: appModel.pendingLink) { _, _ in takePairLink() }
        .sheet(isPresented: $pairing, onDismiss: { linkPayload = nil }) {
            PairingFlow(model: PairingModel(services: appModel.pairingServices, pendingPayload: linkPayload)) { finished in
                pairing = false
                if finished { appModel.navigate(to: .dismiss) }
            }
            .environment(appModel)
        }
    }

    /// The system Camera scanned the Mac's code and opened flint://pair#..., at launch or while this screen is up.
    private func takePairLink() {
        guard case .pair? = appModel.pendingLink, !pairing, case .pair(let payload)? = appModel.takePendingLink() else { return }
        linkPayload = payload
        pairing = true
    }
}
