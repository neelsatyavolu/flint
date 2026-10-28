// "Does anything answer on host:port?" for choosing between guessed server names (track 2C).

import Foundation
import Network

private final class ProbeState: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Bool, Never>?
    private let connection: NWConnection

    init(connection: NWConnection, continuation: CheckedContinuation<Bool, Never>) {
        self.connection = connection
        self.continuation = continuation
    }

    func finish(_ answer: Bool) {
        lock.lock()
        let c = continuation
        continuation = nil
        lock.unlock()
        guard let c else { return }
        connection.cancel()
        c.resume(returning: answer)
    }
}

public func tcpProbe(host: String, port: Int, timeout: TimeInterval = 3) async -> Bool {
    guard let nwPort = NWEndpoint.Port(rawValue: UInt16(clamping: port)), port > 0 else { return false }
    let queue = DispatchQueue(label: "co.xanom.flint.tcpprobe")
    return await withCheckedContinuation { continuation in
        let connection = NWConnection(host: NWEndpoint.Host(host), port: nwPort, using: .tcp)
        let state = ProbeState(connection: connection, continuation: continuation)
        connection.stateUpdateHandler = { newState in
            switch newState {
            case .ready: state.finish(true)
            case .failed, .cancelled: state.finish(false)
            case .waiting: state.finish(false)
            default: break
            }
        }
        queue.asyncAfter(deadline: .now() + timeout) { state.finish(false) }
        connection.start(queue: queue)
    }
}
