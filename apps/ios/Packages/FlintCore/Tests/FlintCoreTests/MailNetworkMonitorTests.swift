import Foundation
import Testing
@testable import FlintMail

@Suite("NetworkMonitor")
struct MailNetworkMonitorTests {
    @Test func theSystemMonitorReportsTheCurrentPathFirst() async {
        let stream = NWPathNetworkMonitor().updates()
        let first = await Task.detached { () -> NetworkPathState? in
            for await state in stream { return state }
            return nil
        }.value
        #expect(first != nil) // a satisfied or unsatisfied state, whichever the machine has
    }

    @Test func pathStatesCompareBySatisfactionAndInterfaces() {
        #expect(NetworkPathState(satisfied: true, signature: "wifi") != NetworkPathState(satisfied: true, signature: "cellular"))
        #expect(NetworkPathState(satisfied: true, signature: "wifi") == NetworkPathState(satisfied: true, signature: "wifi"))
    }

    @Test func backoffDoublesFromFiveSecondsToFiveMinutes() {
        var backoff = Backoff()
        let delays = (0..<8).map { _ in backoff.next() }
        #expect(delays == [.seconds(5), .seconds(10), .seconds(20), .seconds(40), .seconds(80), .seconds(160), .seconds(300), .seconds(300)])
        backoff.reset()
        #expect(backoff.next() == .seconds(5))
    }
}
