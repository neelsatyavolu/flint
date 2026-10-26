// A bounded wait that does not cancel the work. Fetching a message body keeps going after the reader stopped waiting for
// it, lands in the store, and a `mailChanged` event tells the reader to refresh.

import Foundation
import Synchronization

private final class Once: Sendable {
    private let continuation: Mutex<CheckedContinuation<Bool, Never>?>
    init(_ continuation: CheckedContinuation<Bool, Never>) { self.continuation = Mutex(continuation) }
    func resume(_ value: Bool) { continuation.withLock { c -> CheckedContinuation<Bool, Never>? in defer { c = nil }; return c }?.resume(returning: value) }
}

enum Race {
    /// Runs `work` and returns true when it finished within `timeout`, false when the wait ran out first. `work` is not cancelled.
    static func finishes(within timeout: Duration, _ work: @escaping @Sendable () async -> Void) async -> Bool {
        await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
            let once = Once(continuation)
            Task {
                await work()
                once.resume(true)
            }
            Task {
                try? await Task.sleep(for: timeout)
                once.resume(false)
            }
        }
    }
}
