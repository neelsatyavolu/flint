import SwiftUI

/// Registers the Search feature with the shell. Replace `SearchRoot` (the placeholder) with the real screen; keep this type and its id.
struct SearchModule: FeatureModule {
    let id = "search"
    let title = "Search"

    func makeRoot() -> AnyView { AnyView(SearchRoot()) }
}
