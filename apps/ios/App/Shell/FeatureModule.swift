import SwiftUI

/// A self-contained feature (Onboarding, Sidebar, Inbox, ...). Each lives in `App/Features/<Name>/` and
/// provides one conforming type. Features never share files: to appear in the app, add one line to
/// `FeatureRegistry.modules` (ask via `docs/ios/HANDOFF.md`).
@MainActor
protocol FeatureModule {
    /// Stable identifier, also the accessibility identifier prefix, for example `inbox`.
    var id: String { get }
    /// Name shown in debug lists.
    var title: String { get }
    /// The feature's root view.
    func makeRoot() -> AnyView
}
