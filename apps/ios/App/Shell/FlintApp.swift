import SwiftUI
import UIKit

@main
struct FlintApp: App {
    private let launchMark: Void = PerfProbe.mark("appEntry") // first stored property: runs before the model below is built
    @State private var model = BackgroundHub.model
    @State private var lock = AppLock.live(reason: String(localized: "Unlock Flint", table: "Shell"))
    @State private var lockWindow = LockWindowPresenter()
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage(FlintAppearance.defaultsKey) private var appearanceRaw = FlintAppearance.system.rawValue

    private var appearance: FlintAppearance { FlintAppearance.resolved(stored: appearanceRaw) }

    init() {
        BackgroundHub.install()
        BackgroundHub.model.bootstrapAtLaunch()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .accessibilityHidden(lock.isCovering)
                .allowsHitTesting(!lock.isCovering)
                .preferredColorScheme(appearance.colorScheme)
                .onOpenURL { url in model.handle(url: url) }
                .onChange(of: scenePhase, initial: true) { _, phase in Task { await lock.scenePhaseChanged(phase) } }
                .onChange(of: lock.isCovering, initial: true) { _, covering in
                    model.isCovered = covering
                    lockWindow.update(covering: covering, lock: lock, style: Self.style(appearance))
                }
        }
        .commands { FlintCommands(model: model) }
        .onChange(of: scenePhase) { _, phase in
            guard model.phase == .ready else { return }
            switch phase {
            case .active: Task { await model.sceneBecameActive() }
            case .background: Task { await model.sceneEnteredBackground() }
            default: break
            }
        }
    }

    private static func style(_ appearance: FlintAppearance) -> UIUserInterfaceStyle {
        switch appearance {
        case .system: .unspecified
        case .dark: .dark
        case .light: .light
        }
    }
}
