import SwiftUI

/// PLACEHOLDER (track 3A replaces this file). The shell presents it as a sheet when there are no accounts, for `Route.onboarding`
/// and for a `flint://pair` link (the payload waits in `AppModel.pendingLink`).
struct OnboardingRoot: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 0) {
            SheetHeader(title: String(localized: "Add account", table: "Onboarding"), identifier: "onboarding") { model.navigate(to: .dismiss) }
            FlintEmptyState(
                icon: .mail, title: String(localized: "Add an account", table: "Onboarding"),
                message: String(localized: "This screen is a placeholder.", table: "Onboarding"), identifier: "onboarding.placeholder")
        }
        .accessibilityIdentifier("onboarding.root")
    }
}
