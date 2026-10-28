import SwiftUI

/// Registers the Sidebar feature with the shell. Replace `SidebarRoot` (the placeholder) with the real screen; keep this type and its id.
struct SidebarModule: FeatureModule {
    let id = "sidebar"
    let title = "Sidebar"

    func makeRoot() -> AnyView { AnyView(SidebarRoot()) }
}
