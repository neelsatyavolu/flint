import FlintModel
import UIKit

/// Finishes sends that fall due in the few seconds iOS gives an app that has just gone to the background, so a message sent
/// inside its undo window still goes out when the phone is locked. Anything later waits for the next foreground
/// (`AppModel.sceneBecameActive`) or the Wave 4 background task.
struct SendDrain: Sendable {
    enum Outcome: Equatable, Sendable {
        /// Nothing more is due inside the budget.
        case drained
        /// The next item falls due after the budget (or the task was cancelled).
        case deferred(until: EpochMs?)
    }

    /// iOS allows about 30 s; leave room to stop the service afterwards.
    static let defaultBudgetMs: Int = 25_000
    var budgetMs: Int = Self.defaultBudgetMs

    @MainActor
    func run(runDue: () async -> EpochMs?, now: () -> EpochMs, sleep: (Duration) async -> Void) async -> Outcome {
        let deadline = now() + budgetMs
        while !Task.isCancelled {
            guard let next = await runDue() else { return .drained }
            if next > deadline { return .deferred(until: next) }
            await sleep(.milliseconds(max(next - now(), 50)))
        }
        return .deferred(until: nil)
    }
}

/// Asks the system to keep the app running for a short while after it leaves the screen.
@MainActor
protocol BackgroundTasking {
    /// Starts a background task; `expiration` runs if the system is about to suspend the app first.
    func begin(expiration: @escaping @MainActor () -> Void) -> Int
    func end(_ id: Int)
    /// Seconds the system will still keep the app running.
    var timeRemaining: TimeInterval { get }
}

struct SystemBackgroundTasking: BackgroundTasking {
    func begin(expiration: @escaping @MainActor () -> Void) -> Int {
        UIApplication.shared.beginBackgroundTask(withName: "co.xanom.flint.sends", expirationHandler: expiration).rawValue
    }

    func end(_ id: Int) { UIApplication.shared.endBackgroundTask(UIBackgroundTaskIdentifier(rawValue: id)) }

    var timeRemaining: TimeInterval { UIApplication.shared.backgroundTimeRemaining }
}

/// For tests: no system task, the full budget.
struct NoBackgroundTasking: BackgroundTasking {
    func begin(expiration: @escaping @MainActor () -> Void) -> Int { 1 }
    func end(_ id: Int) {}
    var timeRemaining: TimeInterval { 30 }
}

extension AppModel {
    /// Background: keep the app alive long enough to send what falls due inside the undo window, then stop sync sessions and
    /// the scheduler pump.
    func sceneEnteredBackground() async {
        guard let service else { return }
        endBackgroundTask()
        backgroundTaskId = backgroundTasking.begin { [weak self] in self?.backgroundTimeExpired() }
        let budget = min(SendDrain.defaultBudgetMs, Int(max(0, backgroundTasking.timeRemaining - 5) * 1000))
        let drain = Task {
            await SendDrain(budgetMs: budget).run(
                runDue: { await service.runDueWork() },
                now: { EpochMs(Date().timeIntervalSince1970 * 1000) },
                sleep: { try? await Task.sleep(for: $0) })
        }
        drainTask = drain
        _ = await drain.value
        drainTask = nil
        await service.stop()
        endBackgroundTask()
    }

    private func backgroundTimeExpired() {
        drainTask?.cancel()
        endBackgroundTask()
    }

    private func endBackgroundTask() {
        guard let id = backgroundTaskId else { return }
        backgroundTaskId = nil
        backgroundTasking.end(id)
    }
}
