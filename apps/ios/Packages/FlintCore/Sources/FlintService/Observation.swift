// "Observable streams": a value that is fetched once and fetched again whenever a matching event arrives. Bursts of events
// collapse into one refetch (an event that arrives while a fetch runs schedules exactly one more). The UI iterates the
// stream and renders each value; cancelling the iteration unsubscribes.

import FlintModel
import Foundation
import Synchronization

/// Runs `fetch` after each mark, one at a time, folding marks that arrive meanwhile into a single rerun.
private final class Refresher: Sendable {
    private struct State { var dirty = false; var running = false; var finished = false }
    private let state = Mutex(State())
    private let run: @Sendable () async -> Void

    init(run: @escaping @Sendable () async -> Void) { self.run = run }

    func finish() { state.withLock { $0.finished = true } }

    func mark() {
        let start = state.withLock { s -> Bool in
            s.dirty = true
            guard !s.running, !s.finished else { return false }
            s.running = true
            return true
        }
        if start { Task { await loop() } }
    }

    private func loop() async {
        while true {
            let go = state.withLock { s -> Bool in
                if s.dirty && !s.finished { s.dirty = false; return true }
                s.running = false
                return false
            }
            if !go { return }
            await run()
        }
    }
}

extension EventBus {
    /// Yields `fetch()` now and after every event `matches` accepts. A failure of the first fetch ends the stream with that
    /// error; later failures are skipped and the next matching event tries again.
    public func observe<T: Sendable>(
        matching matches: @escaping @Sendable (FlintEvent) -> Bool, fetch: @escaping @Sendable () async throws -> T
    ) -> AsyncThrowingStream<T, Error> {
        AsyncThrowingStream(bufferingPolicy: .bufferingNewest(1)) { continuation in
            let refresher = Refresher {
                if let value = try? await fetch() { continuation.yield(value) }
            }
            // Subscribe before the first fetch so an event during it is not lost.
            let subscription = subscribe { event in if matches(event) { refresher.mark() } }
            let first = Task {
                do { continuation.yield(try await fetch()) } catch { continuation.finish(throwing: error) }
            }
            continuation.onTermination = { _ in
                refresher.finish()
                subscription()
                first.cancel()
            }
        }
    }
}

enum EventFilters {
    static func mailChanged(_ event: FlintEvent) -> Bool {
        switch event {
        case .mailChanged, .send, .code: return true
        default: return false
        }
    }

    static func accountsChanged(_ event: FlintEvent) -> Bool {
        switch event {
        case .mailChanged(_, let ids): return ids.isEmpty
        case .sync(let status): return status.state != .syncing
        default: return false
        }
    }

    static func sync(_ event: FlintEvent) -> Bool {
        if case .sync = event { return true }
        return false
    }

    static func settings(_ event: FlintEvent) -> Bool {
        if case .settings = event { return true }
        return false
    }

    static func receipt(_ event: FlintEvent) -> Bool {
        switch event {
        case .receipt, .send: return true
        default: return false
        }
    }
}
