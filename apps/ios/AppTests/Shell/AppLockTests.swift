@testable import Flint
import SwiftUI
import Testing

/// The Face ID lock's state machine, driven with scripted scene phases and a scripted authenticator.
@Suite("AppLock", .serialized)
@MainActor
struct AppLockTests {
    @MainActor final class Script {
        var enabled = true
        var outcomes: [AuthOutcome] = []
        private(set) var prompts = 0

        func authenticate() async -> AuthOutcome {
            prompts += 1
            return outcomes.isEmpty ? .failed : outcomes.removeFirst()
        }
    }

    private func make(_ script: Script) -> AppLock {
        AppLock(isEnabled: { script.enabled }, authenticate: { await script.authenticate() })
    }

    @Test("disabled: nothing is ever covered or prompted")
    func disabled() async {
        let script = Script()
        script.enabled = false
        let lock = make(script)
        for phase in [ScenePhase.inactive, .active, .inactive, .background, .active] {
            await lock.scenePhaseChanged(phase)
            #expect(!lock.isCovering)
        }
        #expect(script.prompts == 0)
    }

    @Test("enabled at launch: covered at once, the first active scene asks, success unlocks")
    func launch() async {
        let script = Script()
        script.outcomes = [.success]
        let lock = make(script)
        #expect(lock.isCovering && lock.phase == .locked)
        await lock.scenePhaseChanged(.inactive)
        #expect(lock.isCovering)
        await lock.scenePhaseChanged(.active)
        #expect(script.prompts == 1)
        #expect(lock.phase == .unlocked && !lock.isCovering)
    }

    @Test("a failed or cancelled prompt stays locked and does not ask again on the next active scene")
    func failedStaysLocked() async {
        let script = Script()
        script.outcomes = [.failed, .success]
        let lock = make(script)
        await lock.scenePhaseChanged(.active)
        #expect(lock.phase == .locked && lock.isCovering)
        await lock.scenePhaseChanged(.inactive)
        await lock.scenePhaseChanged(.active)
        #expect(script.prompts == 1)
        await lock.unlock()
        #expect(script.prompts == 2 && lock.phase == .unlocked)
    }

    @Test("going to the background locks again; inactive alone only covers")
    func background() async {
        let script = Script()
        script.outcomes = [.success, .success]
        let lock = make(script)
        await lock.scenePhaseChanged(.active)
        #expect(lock.phase == .unlocked)
        await lock.scenePhaseChanged(.inactive)
        #expect(lock.isCovering && lock.phase == .unlocked)
        await lock.scenePhaseChanged(.active)
        #expect(!lock.isCovering && script.prompts == 1)
        await lock.scenePhaseChanged(.inactive)
        await lock.scenePhaseChanged(.background)
        #expect(lock.phase == .locked && lock.isCovering)
        await lock.scenePhaseChanged(.active)
        #expect(script.prompts == 2 && lock.phase == .unlocked)
    }

    @Test("a device without a passcode cannot lock the owner out")
    func unavailable() async {
        let script = Script()
        script.outcomes = [.unavailable]
        let lock = make(script)
        await lock.scenePhaseChanged(.active)
        #expect(lock.phase == .unlocked && !lock.isCovering)
    }

    @Test("turning the setting on while open does not lock until the next background")
    func enabledLater() async {
        let script = Script()
        script.enabled = false
        script.outcomes = [.success]
        let lock = make(script)
        await lock.scenePhaseChanged(.active)
        script.enabled = true
        await lock.scenePhaseChanged(.inactive)
        await lock.scenePhaseChanged(.active)
        #expect(lock.phase == .unlocked && !lock.isCovering)
        await lock.scenePhaseChanged(.background)
        #expect(lock.phase == .locked)
    }

    @Test("the system prompt making the scene inactive and active again does not cover the app after success")
    func promptRoundTrip() async {
        let script = Script()
        script.outcomes = [.success]
        let lock = make(script)
        await lock.scenePhaseChanged(.active)
        await lock.scenePhaseChanged(.inactive)
        await lock.scenePhaseChanged(.active)
        #expect(lock.phase == .unlocked && !lock.isCovering)
    }
}
