// Network.framework transport. Tries every address the Mac advertised in parallel, 5 s each, and keeps the first that connects.
// The first connection to a local address is what makes iOS show the Local Network prompt, so a connection stuck in
// `waiting` is retried once: the user may still be answering the prompt.

import Foundation
import Network

public enum NetworkConnector {
    public static let attemptTimeout: Duration = .seconds(5)

    public static var connector: PairingConnector {
        { addrs, port in try await connect(addrs: addrs, port: port) }
    }

    public static func connect(addrs: [String], port: Int, rounds: Int = 2) async throws -> any PairingTransport {
        var last: PairingError = .unreachable
        for _ in 0..<rounds {
            do { return try await race(addrs: addrs, port: port) } catch let error as PairingError {
                if error == .localNetworkDenied { throw error }
                last = error
            }
        }
        throw last
    }

    private static func race(addrs: [String], port: Int) async throws -> any PairingTransport {
        try await withThrowingTaskGroup(of: (any PairingTransport).self) { group in
            for addr in addrs { group.addTask { try await attempt(host: addr, port: port) } }
            var failure: PairingError = .unreachable
            while let next = await group.nextResult() {
                switch next {
                case .success(let transport):
                    group.cancelAll()
                    return transport
                case .failure(let error):
                    if let e = error as? PairingError, e == .localNetworkDenied { failure = e } else if failure != .localNetworkDenied { failure = .unreachable }
                }
            }
            throw failure
        }
    }

    private static func attempt(host: String, port: Int) async throws -> any PairingTransport {
        guard let raw = UInt16(exactly: port), let nwPort = NWEndpoint.Port(rawValue: raw) else { throw PairingError.badQRCode }
        let connection = NWConnection(host: NWEndpoint.Host(host), port: nwPort, using: .tcp)
        let transport = NetworkTransport(connection)
        do {
            try await withThrowingTaskGroup(of: Void.self) { group in
                group.addTask { try await transport.waitUntilReady() }
                group.addTask {
                    try await Task.sleep(for: attemptTimeout)
                    throw PairingError.unreachable
                }
                defer { group.cancelAll() }
                try await group.next()
            }
            return transport
        } catch {
            transport.close()
            throw error
        }
    }
}

/// One TCP connection. Reads and writes are serialized by the pairing client, which awaits each.
final class NetworkTransport: PairingTransport, @unchecked Sendable {
    private let connection: NWConnection
    private let queue = DispatchQueue(label: "co.xanom.flint.pairing")

    init(_ connection: NWConnection) { self.connection = connection }

    func waitUntilReady() async throws {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                let once = Once(continuation)
                connection.stateUpdateHandler = { state in
                    switch state {
                    case .ready: once.resume(.success(()))
                    case .failed(let error): once.resume(.failure(Self.map(error)))
                    case .waiting(let error): if Self.isDenied(error) { once.resume(.failure(PairingError.localNetworkDenied)) }
                    case .cancelled: once.resume(.failure(PairingError.connectionClosed))
                    default: break
                    }
                }
                connection.start(queue: queue)
            }
        } onCancel: { [connection] in connection.cancel() }
    }

    func send(_ data: Data) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            connection.send(content: data, completion: .contentProcessed { error in
                if error == nil { continuation.resume() } else { continuation.resume(throwing: PairingError.connectionClosed) }
            })
        }
    }

    func receive() async throws -> Data {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Data, Error>) in
            connection.receive(minimumIncompleteLength: 1, maximumLength: PairingLimits.maxFrame) { data, _, isComplete, error in
                if let data, !data.isEmpty { continuation.resume(returning: data) }
                else if error != nil || isComplete { continuation.resume(throwing: PairingError.connectionClosed) }
                else { continuation.resume(returning: Data()) }
            }
        }
    }

    func close() { connection.cancel() }

    private static func map(_ error: NWError) -> PairingError { isDenied(error) ? .localNetworkDenied : .unreachable }

    /// kDNSServiceErr_PolicyDenied (-65570) is how iOS reports a refused Local Network permission.
    static func isDenied(_ error: NWError) -> Bool {
        if case .dns(let code) = error { return code == -65570 }
        return false
    }
}

private final class Once: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Void, Error>?

    init(_ continuation: CheckedContinuation<Void, Error>) { self.continuation = continuation }

    func resume(_ result: Result<Void, Error>) {
        lock.lock()
        let c = continuation
        continuation = nil
        lock.unlock()
        c?.resume(with: result)
    }
}
