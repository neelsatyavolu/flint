import SwiftUI

/// Registers the Inbox feature with the shell. Replace `InboxRoot` (the placeholder) with the real screen; keep this type and its id.
struct InboxModule: FeatureModule {
    let id = "inbox"
    let title = "Inbox"

    func makeRoot() -> AnyView { AnyView(InboxRoot()) }
}
