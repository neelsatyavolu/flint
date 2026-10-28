import Foundation
import Network
import Testing
@testable import FlintPairing

/// `NetworkConnector` against a listener on this Mac's loopback: connect, send, receive, close, race over several addresses, and the
/// failure mapping. No outside network and no simulator.
@Suite("Pairing network loopback", .serialized)
struct PairingNetworkLoopbackTests {
    /// A one-connection echo server on an ephemeral port.
    private final class Echo: @unchecked Sendable {
        let listener: NWListener
        private let queue = DispatchQueue(label: "flint.test.echo")
        let port: Int

        init() async throws {
            listener = try NWListener(using: .tcp, on: .any)
            listener.newConnectionHandler = { [queue] connection in
                connection.start(queue: queue)
                @Sendable func loop() {
                    connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { data, _, done, error in
                        if let data, !data.isEmpty { connection.send(content: data, completion: .contentProcessed { _ in }) }
                        if done || error != nil { connection.cancel() } else { loop() }
                    }
                }
                loop()
            }
            let ready = AsyncStream<Int>.makeStream()
            listener.stateUpdateHandler = { [listener] state in
                if case .ready = state, let port = listener.port?.rawValue { ready.continuation.yield(Int(port)); ready.continuation.finish() }
            }
            listener.start(queue: queue)
            var found = 0
            for await p in ready.stream { found = p }
            port = found
        }

        func stop() { listener.cancel() }
    }

    @Test func connectsSendsAndReceivesOverTCP() async throws {
        let echo = try await Echo()
        defer { echo.stop() }
        let transport = try await NetworkConnector.connector(["127.0.0.1"], echo.port)
        try await transport.send(Data("ping".utf8))
        var received = Data()
        while received.count < 4 { received.append(try await transport.receive()) }
        #expect(received == Data("ping".utf8))
        transport.close()
    }

    @Test func aDeadAddressLosesTheRaceToALiveOne() async throws {
        let echo = try await Echo()
        defer { echo.stop() }
        let transport = try await NetworkConnector.connect(addrs: ["127.0.0.1", "127.0.0.2"], port: echo.port, rounds: 1)
        transport.close()
    }

    @Test func aClosedPortIsUnreachable() async throws {
        let echo = try await Echo()
        let closedPort = echo.port
        echo.stop()
        try await Task.sleep(for: .milliseconds(200))
        await #expect(throws: PairingError.unreachable) { _ = try await NetworkConnector.connect(addrs: ["127.0.0.1"], port: closedPort, rounds: 1) }
    }

    @Test func aPortOutOfRangeFailsInsteadOfCrashing() async throws {
        await #expect(throws: PairingError.unreachable) { _ = try await NetworkConnector.connect(addrs: ["127.0.0.1"], port: 70_000, rounds: 1) }
    }

    @Test func aPeerThatClosesEndsReceiveWithConnectionClosed() async throws {
        let echo = try await Echo()
        defer { echo.stop() }
        let transport = try await NetworkConnector.connector(["127.0.0.1"], echo.port)
        transport.close()
        await #expect(throws: PairingError.connectionClosed) { _ = try await transport.receive() }
    }

    @Test func policyDeniedIsLocalNetworkDenied() {
        #expect(NetworkTransport.isDenied(.dns(-65570)))
        #expect(!NetworkTransport.isDenied(.dns(1)))
        #expect(!NetworkTransport.isDenied(.posix(.ECONNREFUSED)))
    }

    @Test func everyErrorHasAPlainSentence() {
        let all: [PairingError] = [.badQRCode, .unreachable, .localNetworkDenied, .connectionClosed, .timedOut, .badFrame, .tampered, .unexpectedFrame, .weakKey, .bundleTooLarge, .malformedBundle, .unsupportedVersion]
        for error in all {
            let text = try! #require(error.errorDescription)
            #expect(text.hasSuffix(".") && !text.contains("!"))
        }
    }
}
