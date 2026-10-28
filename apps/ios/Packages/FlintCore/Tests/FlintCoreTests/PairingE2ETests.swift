import FlintModel
import Foundation
import Testing
@testable import FlintPairing

/// Talks to the real TypeScript listener on loopback. Started by apps/ios/scripts/pairing-e2e.sh, which sets
/// FLINT_PAIRING_URL (the QR text), FLINT_PAIRING_EVENTS (the listener's stdout file) and FLINT_PAIRING_SCENARIO.
/// Skipped everywhere else. Uses synthetic data only.
private let env = ProcessInfo.processInfo.environment
private let live = env["FLINT_PAIRING_URL"] != nil

@Suite("Pairing end to end", .serialized, .enabled(if: live))
struct PairingE2ETests {
    private func events() -> [[String: Any]] {
        guard let path = env["FLINT_PAIRING_EVENTS"], let text = try? String(contentsOfFile: path, encoding: .utf8) else { return [] }
        return text.split(separator: "\n").compactMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] }
    }

    private func waitForEvent(_ type: String) async throws -> [String: Any] {
        for _ in 0..<100 {
            if let e = events().first(where: { $0["type"] as? String == type }) { return e }
            try await Task.sleep(for: .milliseconds(50))
        }
        throw FlintError(.network, "no \(type) event from the listener")
    }

    private func client() throws -> PairingClient {
        PairingClient(offer: try PairingOffer.parse(env["FLINT_PAIRING_URL"]!), deviceName: "E2E iPhone", connector: NetworkConnector.connector)
    }

    @Test(.enabled(if: env["FLINT_PAIRING_SCENARIO"] == "happy"))
    func pairsAndImportsAgainstTheNodeListener() async throws {
        let client = try client()
        let sas = try await client.connect()
        let approval = try await waitForEvent("approval")
        #expect(approval["sas"] as? String == sas)
        #expect(approval["deviceName"] as? String == "E2E iPhone")

        // A second connection while the first is waiting must be closed without disturbing it.
        let second = try await NetworkConnector.connect(addrs: ["127.0.0.1"], port: try PairingOffer.parse(env["FLINT_PAIRING_URL"]!).port, rounds: 1)
        await #expect(throws: PairingError.connectionClosed) { _ = try await second.receive() }

        let bundle = try await client.receiveBundle()
        #expect(bundle.accounts.map(\.email) == ["neel@example.com", "neel@gmail.com"])
        #expect(bundle.accounts[0].password == "app-password-1")
        let google = bundle.accounts[1]
        #expect(google.needsGoogleSignIn && google.password == nil)
        let text = String(decoding: try bundle.encoded(), as: UTF8.self).lowercased()
        #expect(!text.contains("token") && !text.contains("ya29") && !text.contains("secret"))
        try await client.acknowledge(ImportCounts(accounts: 2, signatures: 1, templates: 1, rules: 1, blockedSenders: 1))

        let done = try await waitForEvent("done")
        #expect(done["devices"] as? Int == 1)
    }

    @Test(.enabled(if: env["FLINT_PAIRING_SCENARIO"] == "deny"))
    func aMacThatDeniesTheCodeSendsNothing() async throws {
        let client = try client()
        _ = try await client.connect()
        await #expect(throws: PairingError.connectionClosed) { _ = try await client.receiveBundle() }
        _ = try await waitForEvent("closed")
    }

    @Test(.enabled(if: env["FLINT_PAIRING_SCENARIO"] == "expired"))
    func anExpiredSessionRefusesNewConnections() async throws {
        _ = try await waitForEvent("closed")
        let client = try client()
        await #expect(throws: PairingError.self) { _ = try await client.connect() }
    }
}
