// Network path changes. NIO sockets do not follow a Wi-Fi to cellular handoff, so the session reconnects when the path
// changes (design notes, section 2, known gap 4).

import Foundation
import Network

public struct NetworkPathState: Hashable, Sendable {
    public var satisfied: Bool
    /// Changes when the interfaces in use change (Wi-Fi to cellular), so a handoff is a new state even when still satisfied.
    public var signature: String

    public init(satisfied: Bool, signature: String = "") {
        self.satisfied = satisfied
        self.signature = signature
    }
}

public protocol NetworkMonitoring: Sendable {
    /// The first value is the current state; later values are changes.
    func updates() -> AsyncStream<NetworkPathState>
}

public struct NWPathNetworkMonitor: NetworkMonitoring {
    public init() {}

    public func updates() -> AsyncStream<NetworkPathState> {
        AsyncStream { continuation in
            let monitor = NWPathMonitor()
            monitor.pathUpdateHandler = { path in
                let signature = path.availableInterfaces.map { "\($0.type)" }.sorted().joined(separator: ",")
                continuation.yield(NetworkPathState(satisfied: path.status == .satisfied, signature: signature))
            }
            continuation.onTermination = { _ in monitor.cancel() }
            monitor.start(queue: DispatchQueue(label: "co.xanom.flint.network-path"))
        }
    }
}
