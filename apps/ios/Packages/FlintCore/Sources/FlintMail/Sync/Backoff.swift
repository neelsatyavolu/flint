// Reconnect delay: 5 s doubling to 5 min.

import Foundation

public struct Backoff: Hashable, Sendable {
    public var minimum: Duration
    public var maximum: Duration
    public private(set) var current: Duration

    public init(minimum: Duration = .seconds(5), maximum: Duration = .seconds(300)) {
        self.minimum = minimum
        self.maximum = maximum
        self.current = minimum
    }

    /// The delay to wait now; the following call waits twice as long, up to the maximum.
    public mutating func next() -> Duration {
        let delay = current
        current = min(current * 2, maximum)
        return delay
    }

    public mutating func reset() { current = minimum }
}
