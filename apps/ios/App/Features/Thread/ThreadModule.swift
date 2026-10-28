import SwiftUI

/// Registers the Thread feature with the shell. Replace `ThreadRoot` (the placeholder) with the real screen; keep this type and its id.
struct ThreadModule: FeatureModule {
    let id = "thread"
    let title = "Thread"

    func makeRoot() -> AnyView { AnyView(ThreadRoot()) }
}
