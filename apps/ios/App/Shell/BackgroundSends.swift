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
        // `backgroundTimeRemaining` is `greatestFiniteMagnitude` until a task has begun: clamp before converting to Int.
        let remaining = min(max(0, backgroundTasking.timeRemaining - 5), Double(SendDrain.defaultBudgetMs) / 1000)
        let budget = Int(remaining * 1000)
        var nextDue: EpochMs?
        await backgroundCycle(
            drain: {
                let outcome = await SendDrain(budgetMs: budget).run(
                    runDue: { await service.runDueWork() },
                    now: { EpochMs(Date().timeIntervalSince1970 * 1000) },
                    sleep: { try? await Task.sleep(for: $0) })
                if case .deferred(let until) = outcome { nextDue = until }
                return outcome
            },
            stop: { await service.stop() })
        // What is still due waits for a background slot (`BGProcessingTask`) or a local notification.
        scheduleBackgroundWork(nextDue: nextDue)
    }

    /// One trip to the background. Each cycle owns its background task, and coming back to the foreground ends the cycle's
    /// claim on the service: the drain is cancelled and the service is left running.
    func backgroundCycle(drain: @escaping @MainActor () async -> SendDrain.Outcome, stop: () async -> Void) async {
        backgroundEpoch += 1
        let epoch = backgroundEpoch
        drainTask?.cancel()
        var taskId: Int?
        taskId = backgroundTasking.begin { [weak self] in
            self?.drainTask?.cancel()
            if let id = taskId {
                taskId = nil
                self?.backgroundTasking.end(id)
            }
        }
        let task = Task { await drain() }
        drainTask = task
        _ = await task.value
        if epoch == backgroundEpoch {
            drainTask = nil
            await stop()
            backgroundStops += 1
        }
        if let id = taskId {
            taskId = nil
            backgroundTasking.end(id)
        }
    }

    /// Foreground: the waiting drain (if any) is no longer wanted and must not stop the service.
    func cancelBackgroundDrain() {
        backgroundEpoch += 1
        drainTask?.cancel()
        drainTask = nil
    }
}
