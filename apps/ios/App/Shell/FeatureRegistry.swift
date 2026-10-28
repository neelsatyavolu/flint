import SwiftUI

/// All feature modules, in display order. This file belongs to the shell (Wave 3 prep). Each feature track replaces the
/// placeholder inside its own `Features/<Name>/` folder and never edits this file: the entries below already exist.
@MainActor
enum FeatureRegistry {
    static let modules: [any FeatureModule] = [
        OnboardingModule(), SidebarModule(), InboxModule(), ThreadModule(), ComposerModule(), SearchModule(), SettingsModule(), ReceiptsModule(),
    ]

    static func module(id: String) -> (any FeatureModule)? {
        modules.first { $0.id == id }
    }

    /// The root view of a feature, or an empty view when the id is unknown (a typo shows nothing rather than crashing).
    static func root(_ id: String) -> AnyView {
        module(id: id)?.makeRoot() ?? AnyView(EmptyView())
    }
}
