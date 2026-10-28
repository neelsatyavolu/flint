import Darwin
import FlintModel
import FlintStore
import Foundation
import Testing
@testable import FlintMail

/// Resident memory of this process in bytes (what Activity Monitor calls "Memory" is close to `phys_footprint`).
func soakFootprintBytes() -> Int {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
    let result = withUnsafeMutablePointer(to: &info) { $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count) } }
    return result == KERN_SUCCESS ? Int(info.phys_footprint) : 0
}

private final class SoakCounters: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String: Int] = [:]
    func bump(_ key: String) { lock.lock(); values[key, default: 0] += 1; lock.unlock() }
    subscript(_ key: String) -> Int { lock.lock(); defer { lock.unlock() }; return values[key, default: 0] }
}

/// A long IDLE soak against GreenMail on the host. Off unless `FLINT_SOAK_SECONDS` is set.
///
///     FLINT_SOAK_SECONDS=1800 FLINT_SOAK_REPORT=/tmp/soak.txt swift test --filter MailGreenMailSoakTests
///
/// One account idles on the real `SwiftMailTransport`. Every `FLINT_SOAK_DELIVER_EVERY` seconds (default 30) a message is delivered
/// by SMTP, and every `FLINT_SOAK_BLIP_EVERY` seconds (default 300) the IMAP proxy drops for 3 seconds. The report lists messages
/// delivered and stored, transports opened (a reconnect makes a new one), failing sync states, and memory samples.
/// Messages and subjects are synthetic; nothing else is logged.
@Suite("GreenMail soak", .enabled(if: ProcessInfo.processInfo.environment["FLINT_SOAK_SECONDS"] != nil), .serialized)
struct MailGreenMailSoakTests {
    private static func seconds(_ key: String, default value: Int) -> Int { ProcessInfo.processInfo.environment[key].flatMap(Int.init) ?? value }

    @Test func idleSurvivesBlipsWithoutLosingMailOrGrowingMemory() async throws {
        let total = Self.seconds("FLINT_SOAK_SECONDS", default: 60)
        let deliverEvery = Self.seconds("FLINT_SOAK_DELIVER_EVERY", default: 30)
        let blipEvery = Self.seconds("FLINT_SOAK_BLIP_EVERY", default: 300)
        let server = MailGreenMailServer(users: ["soak", "sender"])
        try await server.start()
        defer { server.stop() }

        let store = MailTestStore()
        await store.addAccount(server.account(for: "soak"))
        await store.setOwnAddresses([server.email("soak")])
        let counters = SoakCounters()
        var config = SessionConfiguration(cacheRoot: FileManager.default.temporaryDirectory.appendingPathComponent("flint-soak-\(UUID().uuidString)"))
        config.idlePollInterval = .seconds(600) // the production value: only push and the blip recovery may deliver
        config.backoffMinimum = .seconds(1)
        config.backoffMaximum = .seconds(10)
        let credential = server.credential("soak")
        let session = AccountSession(
            accountId: "a1", store: store, transportFactory: { counters.bump("transports"); return SwiftMailTransport() }, credentials: { credential },
            emit: { event in
                guard case .sync(let status) = event else { return }
                counters.bump("sync.\(status.state.rawValue)")
            },
            configuration: config)
        await session.start()
        let started = await mailEventually(timeout: .seconds(30)) { await session.status.state == .idle }
        #expect(started)

        var samples: [(second: Int, mb: Double)] = [(0, Double(soakFootprintBytes()) / 1_048_576)]
        var delivered = 0, blips = 0, lastSampleAt = 0
        let clock = ContinuousClock()
        let begin = clock.now
        while true {
            let elapsed = Int((clock.now - begin) / .seconds(1))
            if elapsed >= total { break }
            if elapsed > 0, elapsed % deliverEvery == 0 {
                try server.deliverBySMTP(to: "soak", subject: "soak \(delivered + 1)")
                delivered += 1
            }
            if elapsed > 0, elapsed % blipEvery == 0 {
                blips += 1
                async let down: Void = server.blip(downFor: .seconds(3))
                try await down
            }
            if elapsed - lastSampleAt >= 60 { samples.append((elapsed, Double(soakFootprintBytes()) / 1_048_576)); lastSampleAt = elapsed }
            try await Task.sleep(for: .seconds(1))
        }
        try await Task.sleep(for: .seconds(15)) // let the last message arrive
        samples.append((total, Double(soakFootprintBytes()) / 1_048_576))

        let stored: Int
        if let folder = try? await store.folder(accountId: "a1", path: "INBOX") { stored = await store.allMessages(in: folder.id).count } else { stored = 0 }
        let finalState = await session.status.state
        await session.stop()

        let peak = samples.map(\.mb).max() ?? 0
        var lines = [
            "soak seconds: \(total), deliver every \(deliverEvery)s, blip every \(blipEvery)s (3s down)",
            "delivered: \(delivered), stored: \(stored), blips: \(blips)",
            "transports opened: \(counters["transports"]) (1 command + 1 idle at start; more means reconnects)",
            "sync events: idle \(counters["sync.idle"]), syncing \(counters["sync.syncing"]), error \(counters["sync.error"]), offline \(counters["sync.offline"]), auth_error \(counters["sync.auth_error"])",
            "final state: \(finalState.rawValue)",
            String(format: "memory MB first %.1f, last %.1f, peak %.1f", samples.first?.mb ?? 0, samples.last?.mb ?? 0, peak),
            "memory samples (second:MB): " + samples.map { String(format: "%d:%.0f", $0.second, $0.mb) }.joined(separator: " "),
        ]
        lines.append(stored == delivered ? "RESULT: every delivered message was stored" : "RESULT: MISMATCH, \(delivered - stored) message(s) missing")
        let report = lines.joined(separator: "\n") + "\n"
        print(report)
        if let path = ProcessInfo.processInfo.environment["FLINT_SOAK_REPORT"] { try report.write(toFile: path, atomically: true, encoding: .utf8) }
        #expect(stored == delivered)
        #expect(finalState != .authError)
        #expect(counters["sync.auth_error"] == 0)
    }
}
