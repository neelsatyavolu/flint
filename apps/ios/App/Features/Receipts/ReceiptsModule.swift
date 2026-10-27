import SwiftUI

/// Registers Read statuses with the shell. The id is `receipts`; the shell adds it to `FeatureRegistry` and a route when it
/// wants a sidebar or Settings entry (see HANDOFF.md, 4A). Until then the list opens from the thread's read status.
struct ReceiptsModule: FeatureModule {
    let id = "receipts"
    let title = "Read statuses"

    func makeRoot() -> AnyView { AnyView(ReadStatusesSheet()) }
}
