import SwiftUI

@main
struct FlintApp: App {
    @State private var router = AppRouter()
    @AppStorage(FlintAppearance.defaultsKey) private var appearanceRaw = FlintAppearance.system.rawValue

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(router)
                .preferredColorScheme(FlintAppearance.resolved(stored: appearanceRaw).colorScheme)
                .onOpenURL { url in router.handle(url) }
        }
    }
}
