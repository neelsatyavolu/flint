import Foundation
import Logging
import Synchronization
import Testing
@testable import FlintMail
@testable import FlintService

@Suite("IDLE reconnect signal", .serialized)
struct IdleReconnectBusTests {
    private static let cycleLabel = IdleReconnectBus.loggerLabelPrefix + "ABC"

    @Test func onlyTheCycleLoggersReconnectLineMatches() {
        #expect(IdleReconnectBus.isReconnect(label: Self.cycleLabel, message: "Reconnected IDLE session for mailbox 'INBOX'"))
        #expect(!IdleReconnectBus.isReconnect(label: Self.cycleLabel, message: "Cycle 3: starting IDLE"))
        #expect(!IdleReconnectBus.isReconnect(label: "swiftmail.imap", message: "Reconnected IDLE session for mailbox 'INBOX'"))
    }

    @Test func aReportReachesEveryOpenStreamAndNotAClosedOne() async {
        let first = IdleReconnectBus.stream()
        let second = IdleReconnectBus.stream()
        IdleReconnectBus.report()
        var firstIterator = first.makeAsyncIterator()
        var secondIterator = second.makeAsyncIterator()
        #expect(await firstIterator.next() != nil)
        #expect(await secondIterator.next() != nil)
    }

    @Test func theHandlerForwardsTheReconnectLineWithoutLoggingIt() async {
        let sunk = Mutex<[String]>([])
        let log = Logger(label: Self.cycleLabel) { label in
            PrivacyLogHandler(label: label, sink: { line in sunk.withLock { $0.append(line) } })
        }
        let stream = IdleReconnectBus.stream()
        log.info("Cycle 1: starting IDLE", metadata: ["imap.host": "imap.example.com"])
        log.info("Reconnected IDLE session for mailbox 'INBOX'")
        var iterator = stream.makeAsyncIterator()
        #expect(await iterator.next() != nil)
        #expect(sunk.withLock { $0.isEmpty }, "an info line never reaches the log, only the bus")
    }
}
