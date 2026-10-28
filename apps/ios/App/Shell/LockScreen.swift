import SwiftUI
import UIKit

/// The flat cover shown while the Face ID lock is on and the app is locked, or the scene is not active (app switcher).
/// An opaque plane with the Flint mark; no blur, no glass.
struct LockScreenView: View {
    let lock: AppLock

    var body: some View {
        ZStack {
            FlintColor.plane1.ignoresSafeArea()
            VStack(spacing: FlintMetrics.Space.s6) {
                FlintMark()
                    .stroke(FlintColor.fg4, style: StrokeStyle(lineWidth: 2, lineJoin: .round))
                    .frame(width: 96, height: 96)
                    .accessibilityHidden(true)
                if lock.phase == .locked {
                    Text("Flint is locked", tableName: "Shell")
                        .flintText(.title, color: FlintColor.fg)
                    Button { Task { await lock.unlock() } } label: {
                        Text("Unlock", tableName: "Shell")
                    }
                    .buttonStyle(FlintButtonStyle(kind: .primary))
                    .accessibilityIdentifier("lock.unlock")
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("lock.screen")
    }
}

/// Puts the lock screen in a window of its own above everything, so it also covers sheets, the composer panel and the keyboard.
@MainActor
final class LockWindowPresenter {
    private var window: UIWindow?

    func update(covering: Bool, lock: AppLock, style: UIUserInterfaceStyle) {
        if covering { show(lock: lock, style: style) } else { hide() }
    }

    private func show(lock: AppLock, style: UIUserInterfaceStyle) {
        if let window {
            window.overrideUserInterfaceStyle = style
            return
        }
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else { return }
        let window = UIWindow(windowScene: scene)
        let controller = UIHostingController(rootView: LockScreenView(lock: lock))
        controller.view.accessibilityViewIsModal = true
        window.rootViewController = controller
        window.windowLevel = .alert + 100
        window.overrideUserInterfaceStyle = style
        window.makeKeyAndVisible()
        self.window = window
    }

    private func hide() {
        guard let window else { return }
        let scene = window.windowScene
        window.isHidden = true
        self.window = nil
        scene?.windows.first { !$0.isHidden }?.makeKey()
    }
}
