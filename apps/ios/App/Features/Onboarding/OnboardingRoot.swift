import SwiftUI

/// The add-account flow, shown as a sheet by the shell: when a live launch has no accounts, for `Route.onboarding`, and for a
/// `flint://pair` link (the link waits in `AppModel.pendingLink` until pairing exists in wave 4).
struct OnboardingRoot: View {
    @Environment(AppModel.self) private var appModel

    var body: some View {
        OnboardingContent(model: OnboardingModel(services: AppOnboardingServices(model: appModel)))
    }
}

private struct OnboardingContent: View {
    @Environment(AppModel.self) private var appModel
    @State var model: OnboardingModel

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    stepView
                }
                .frame(maxWidth: 520, alignment: .leading)
                .padding(.horizontal, FlintMetrics.Space.s4)
                .padding(.vertical, FlintMetrics.Space.s6)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(FlintColor.plane1.ignoresSafeArea())
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("onboarding.root")
    }

    @ViewBuilder private var stepView: some View {
        switch model.step {
        case .welcome: WelcomeStep(model: model, hasAccounts: !appModel.accounts.isEmpty)
        case .otherEmail: OtherEmailStep(model: model)
        case .choices: ChoicesStep(model: model) { appModel.navigate(to: .dismiss) }
        }
    }

    private var header: some View {
        FlintBar(title: title, plane: FlintColor.plane1) {
            leading
        } trailing: {
            EmptyView()
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("onboarding.header")
    }

    @ViewBuilder private var leading: some View {
        switch model.step {
        case .otherEmail:
            FlintIconButton(icon: .arrowLeft, label: String(localized: "Back", table: "Onboarding"), identifier: "onboarding.back") { model.back() }
        case .welcome:
            if canClose {
                FlintIconButton(icon: .close, label: String(localized: "Close", table: "Shared"), identifier: "onboarding.close") { appModel.navigate(to: .dismiss) }
            } else {
                Color.clear.frame(width: FlintMetrics.Size.touch, height: FlintMetrics.Size.touch)
            }
        case .choices:
            Color.clear.frame(width: FlintMetrics.Size.touch, height: FlintMetrics.Size.touch)
        }
    }

    private var canClose: Bool { !appModel.accounts.isEmpty || appModel.isDemo }

    private var title: String {
        switch model.step {
        case .welcome: String(localized: "Add account", table: "Onboarding")
        case .otherEmail: String(localized: "Other email", table: "Onboarding")
        case .choices: String(localized: "Almost done", table: "Onboarding")
        }
    }
}
