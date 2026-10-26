import SwiftUI

/// Registers the Settings feature with the shell. Replace `SettingsRoot` (the placeholder) with the real screen; keep this type and its id.
struct SettingsModule: FeatureModule {
    let id = "settings"
    let title = "Settings"

    func makeRoot() -> AnyView { AnyView(SettingsRoot()) }
}
