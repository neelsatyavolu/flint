// The event bus behind `FlintService.events()`. Mirrors the desktop `EventBus`: the engine emits `FlintEvent`s from any
// task, any number of subscribers receive them in order. Listeners must be quick (mark dirty, yield to a stream); slow work
// belongs in the subscriber's own task.

import FlintModel
import Foundation
import Synchronization

public final class EventBus: Sendable {
    public typealias Listener = @Sendable (FlintEvent) -> Void

    /// Cancels a listener. Safe to call more than once.
    public struct Subscription: Sendable {
        fileprivate let cancel: @Sendable () -> Void
        public func callAsFunction() { cancel() }
    }

    private struct State {
        var next = 0
        var listeners: [Int: Listener] = [:]
    }

    private let state = Mutex(State())

    public init() {}

    /// Delivers `event` to every listener, in subscription order.
    public func emit(_ event: FlintEvent) {
        let current = state.withLock { s in s.listeners.sorted { $0.key < $1.key }.map(\.value) }
        for listener in current { listener(event) }
    }

    public func subscribe(_ listener: @escaping Listener) -> Subscription {
        let id = state.withLock { s -> Int in
            s.next += 1
            s.listeners[s.next] = listener
            return s.next
        }
        return Subscription(cancel: { [weak self] in
            self?.state.withLock { $0.listeners[id] = nil }
        })
    }

    /// An unbounded stream of every event emitted after this call. The subscription ends with the stream.
    public func stream() -> AsyncStream<FlintEvent> {
        AsyncStream { continuation in
            let subscription = subscribe { continuation.yield($0) }
            continuation.onTermination = { _ in subscription() }
        }
    }

    public var listenerCount: Int { state.withLock { $0.listeners.count } }
}
