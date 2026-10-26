import Foundation
import Observation
import SwiftUI

/// The "Require Face ID" lock. When the setting is on, the app is covered on launch, whenever the scene is not active (so the
/// app switcher shows the flat cover, not mail) and locked again when it goes to the background. Coming back asks for Face ID
/// or the passcode once; a cancelled prompt stays on the lock screen with an Unlock button instead of asking in a loop.
@MainActor @Observable
final class AppLock {
    enum Phase: Equatable { case unlocked, locked, authenticating }

    private(set) var phase: Phase = .unlocked
    /// The scene is not active: cover the content for the app switcher even though the person is still unlocked.
    private(set) var shielded = false
    @ObservationIgnored private var asksOnActive = false
    @ObservationIgnored private var sceneActive = false
    @ObservationIgnored private let isEnabled: @MainActor () -> Bool
    @ObservationIgnored private let authenticate: @MainActor () async -> AuthOutcome

    init(isEnabled: @escaping @MainActor () -> Bool, authenticate: @escaping @MainActor () async -> AuthOutcome) {
        self.isEnabled = isEnabled
        self.authenticate = authenticate
        if isEnabled() {
            phase = .locked
            asksOnActive = true
        }
    }

    /// Whether the lock screen is on top of the app.
    var isCovering: Bool { phase != .unlocked || shielded }

    func scenePhaseChanged(_ scene: ScenePhase) async {
        sceneActive = scene == .active
        guard isEnabled() else {
            phase = .unlocked
            shielded = false
            return
        }
        switch scene {
        case .active:
            if phase == .unlocked { shielded = false }
            if phase == .locked, asksOnActive { await unlock() }
        case .inactive:
            shielded = true
        case .background:
            shielded = true
            phase = .locked
            asksOnActive = true
        @unknown default:
            break
        }
    }

    /// Asks for Face ID or the passcode (the Unlock button, and the first active scene after a lock).
    func unlock() async {
        guard phase == .locked else { return }
        phase = .authenticating
        asksOnActive = false
        let outcome = await authenticate()
        switch outcome {
        case .success, .unavailable:
            phase = .unlocked
            shielded = !sceneActive
        case .failed:
            phase = .locked
        }
    }

    /// The real lock: the setting in `defaults`, and the device's Face ID or passcode. Launch arguments for UI tests:
    /// `-FlintFakeAuth pass|fail|unavailable` replaces the system prompt.
    static func live(defaults: UserDefaults = .standard, reason: String) -> AppLock {
        let fake = FlintDebugFlags.fakeAuthentication(defaults: defaults)
        return AppLock(
            isEnabled: { defaults.bool(forKey: SettingsDefaultsKey.faceIDLock) },
            authenticate: {
                if let fake { return fake }
                return await DeviceAuthentication.authenticate(reason: reason)
            })
    }
}
