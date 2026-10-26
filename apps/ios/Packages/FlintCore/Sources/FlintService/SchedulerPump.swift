// iOS has no resident timer, so while the app is in the foreground the service pumps `MailScheduler.tick()` itself: run
// what is due, sleep until the next due time (never longer than a minute), run again. `poke()` wakes it when a send is
// queued or a snooze is set. A background task calls `FlintService.runDueWork()` for the same instant.

import FlintModel
import Foundation

actor SchedulerPump {
    static let maxSleep: Duration = .seconds(60)
    static let minSleep: Duration = .milliseconds(250)

    private let now: @Sendable () -> EpochMs
    private var tick: (@Sendable () async -> EpochMs?)?
    private var loop: Task<Void, Never>?
    private var waiter: CheckedContinuation<Void, Never>?
    private var pendingWake = false
    private var generation = 0

    init(now: @escaping @Sendable () -> EpochMs) { self.now = now }

    func bind(_ tick: @escaping @Sendable () async -> EpochMs?) { self.tick = tick }

    func start() {
        guard loop == nil else { return }
        loop = Task { [weak self] in await self?.run() }
    }

    func stop() async {
        let running = loop
        loop = nil
        running?.cancel()
        wakeNow()
        await running?.value
    }

    /// Safe from any context (called inside store-adjacent closures that are not async).
    nonisolated func poke() { Task { await self.wakeNow() } }

    private func wakeNow() {
        if let waiter {
            self.waiter = nil
            waiter.resume()
        } else {
            pendingWake = true
        }
    }

    private func run() async {
        while !Task.isCancelled {
            let next = await tick?()
            await sleep(for: delay(until: next))
        }
    }

    private func delay(until next: EpochMs?) -> Duration {
        guard let next else { return Self.maxSleep }
        let ms = max(0, next - now())
        return min(max(.milliseconds(ms), Self.minSleep), Self.maxSleep)
    }

    private func sleep(for duration: Duration) async {
        if pendingWake {
            pendingWake = false
            return
        }
        generation += 1
        let mine = generation
        let timer = Task { [weak self] in
            try? await Task.sleep(for: duration)
            await self?.timerFired(mine)
        }
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in waiter = continuation }
        timer.cancel()
    }

    private func timerFired(_ mine: Int) {
        guard mine == generation, let waiter else { return }
        self.waiter = nil
        waiter.resume()
    }
}
