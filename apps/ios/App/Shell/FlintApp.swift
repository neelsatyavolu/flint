import SwiftUI

@main
struct FlintApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage(FlintAppearance.defaultsKey) private var appearanceRaw = FlintAppearance.system.rawValue

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .preferredColorScheme(FlintAppearance.resolved(stored: appearanceRaw).colorScheme)
                .onOpenURL { url in model.handle(url: url) }
        }
        .onChange(of: scenePhase) { _, phase in
            guard model.phase == .ready else { return }
            switch phase {
            case .active: Task { await model.sceneBecameActive() }
            case .background: Task { await model.sceneEnteredBackground() }
            default: break
            }
        }
    }
}
