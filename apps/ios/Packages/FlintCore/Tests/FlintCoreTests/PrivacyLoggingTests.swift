import Foundation
import Logging
import Synchronization
import Testing
@testable import FlintService

private final class Captured: Sendable {
    private let lines = Mutex<[String]>([])
    func add(_ line: String) { lines.withLock { $0.append(line) } }
    var all: [String] { lines.withLock { $0 } }
}

@Suite("Privacy-safe logging")
struct PrivacyLoggingTests {
    private func logger(_ captured: Captured, minimum: Logger.Level = .warning) -> Logger {
        Logger(label: "swiftmail.imap") { label in
            PrivacyLogHandler(label: label, minimumLevel: minimum, sink: { captured.add($0) })
        }
    }

    @Test func infoAndBelowAreDropped() {
        let captured = Captured()
        let log = logger(captured)
        log.info("connecting to imap.example.com as me@example.com")
        log.debug("A1 LOGIN me@example.com hunter2")
        log.trace("raw bytes")
        #expect(captured.all.isEmpty)
    }

    @Test func warningsKeepOnlyLevelAndLabel() {
        let captured = Captured()
        let log = logger(captured)
        log.warning("login failed for me@example.com on imap.example.com", metadata: ["host": "imap.example.com", "password": "hunter2"])
        log.error("body: Dear Ann, your code is 123456")
        #expect(captured.all == ["warning swiftmail.imap", "error swiftmail.imap"])
        let joined = captured.all.joined()
        for secret in ["example.com", "hunter2", "123456", "Dear Ann"] { #expect(!joined.contains(secret)) }
    }

    @Test func handlerDoesNotStoreMetadataOrChangeLevelByAccident() {
        var handler = PrivacyLogHandler(label: "x", minimumLevel: .error, sink: { _ in })
        handler[metadataKey: "host"] = "imap.example.com"
        #expect(handler.metadata.isEmpty)
        #expect(handler.logLevel == .error)
        handler.logLevel = .critical
        #expect(handler.logLevel == .critical)
    }
}
