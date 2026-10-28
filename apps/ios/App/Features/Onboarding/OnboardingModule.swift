import SwiftUI

/// Registers the Onboarding feature with the shell. Replace `OnboardingRoot` (the placeholder) with the real screen; keep this type and its id.
struct OnboardingModule: FeatureModule {
    let id = "onboarding"
    let title = "Add account"

    func makeRoot() -> AnyView { AnyView(OnboardingRoot()) }
}
