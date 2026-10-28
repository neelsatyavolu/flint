import SwiftUI

/// Registers the Composer feature with the shell. Replace `ComposerRoot` (the placeholder) with the real screen; keep this type and its id.
struct ComposerModule: FeatureModule {
    let id = "composer"
    let title = "Composer"

    func makeRoot() -> AnyView { AnyView(ComposerRoot()) }
}
