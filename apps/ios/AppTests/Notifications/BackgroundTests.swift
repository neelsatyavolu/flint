@testable import Flint
import FlintModel
import Foundation
import Testing

@Suite("BackgroundDiagnostics")
struct BackgroundDiagnosticsTests {
    static func record(minutesAgo: Int, kind: BackgroundRunRecord.Kind = .refresh, newMail: Int = 0) -> BackgroundRunRecord {
        BackgroundRunRecord(id: UUID(), kind: kind, startedAt: Date(timeIntervalSince1970: 1_800_000_000 - Double(minutesAgo) * 60), durationMs: 900, result: .completed, newMail: newMail, alerts: newMail, errorCode: nil)
    }

    @Test("newest first, capped")
    func capped() {
        var diagnostics = BackgroundDiagnostics()
        for index in 0..<(BackgroundDiagnostics.capacity + 5) { diagnostics = diagnostics.adding(Self.record(minutesAgo: 1000 - index)) }
        #expect(diagnostics.runs.count == BackgroundDiagnostics.capacity)
        #expect(diagnostics.last?.startedAt == diagnostics.runs.map(\.startedAt).max())
    }

    @Test("check now runs do not count as system runs, and the gap is the mean between system runs")
    func cadence() {
        var diagnostics = BackgroundDiagnostics()
        for run in [Self.record(minutesAgo: 120), Self.record(minutesAgo: 60), Self.record(minutesAgo: 0), Self.record(minutesAgo: 30, kind: .checkNow, newMail: 3)] {
            diagnostics = diagnostics.adding(run)
        }
        #expect(diagnostics.systemRuns.count == 3)
        #expect(diagnostics.averageGapMinutes == 60)
        #expect(diagnostics.totalNewMail == 3)
        #expect(BackgroundDiagnostics().averageGapMinutes == nil)
        #expect(BackgroundDiagnostics().lastSystemRun == nil)
    }

    @Test("the store keeps runs across loads and can clear them")
    func store() throws {
        let name = "flint.tests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        let store = BackgroundDiagnosticsStore(defaults: defaults)
        #expect(store.load().runs.isEmpty)
        store.append(Self.record(minutesAgo: 5))
        let second = Self.record(minutesAgo: 1, newMail: 2)
        store.append(second)
        #expect(BackgroundDiagnosticsStore(defaults: defaults).load().runs.first == second)
        store.clear()
        #expect(store.load().runs.isEmpty)
    }

    @Test("text describes a run without naming any mail")
    func text() {
        var run = Self.record(minutesAgo: 0, newMail: 2)
        #expect(NotificationsText.counts(run) == "2 new conversations, 2 alerts")
        run.newMail = 0
        run.alerts = 0
        #expect(NotificationsText.counts(run) == "Nothing new")
        run.result = .failed
        run.errorCode = "network"
        #expect(NotificationsText.result(run) == "Failed (network)")
        run.result = .expired
        #expect(NotificationsText.result(run) == "Ran out of time")
        #expect(NotificationsText.gap(45) == "45 min")
        #expect(NotificationsText.gap(180) == "3 hours")
        #expect(NotificationsText.lastRun(BackgroundDiagnostics()) == "No background run yet")
    }

    @Test("switching an account's alerts off and on edits the list")
    func accountList() {
        #expect(NotificationsText.disabledAccounts(["a"], toggling: "b", enabled: false) == ["a", "b"])
        #expect(NotificationsText.disabledAccounts(["a", "b"], toggling: "a", enabled: true) == ["b"])
        #expect(NotificationsText.disabledAccounts(["a"], toggling: "a", enabled: false) == ["a"])
    }
}

@Suite("BackgroundPlan")
struct BackgroundPlanTests {
    let now = Date(timeIntervalSince1970: 1_800_000_000)

    @Test("refresh asks for about 15 minutes ahead")
    func refresh() {
        #expect(BackgroundPlan.nextRefresh(now: now) == now.addingTimeInterval(900))
    }

    @Test("processing waits for the next due item but never sooner than a minute")
    func processing() {
        let dueMs = Int(now.timeIntervalSince1970 * 1000)
        #expect(BackgroundPlan.nextProcessing(nextDue: dueMs + 3_600_000, now: now) == now.addingTimeInterval(3600))
        #expect(BackgroundPlan.nextProcessing(nextDue: dueMs - 5, now: now) == now.addingTimeInterval(60))
        #expect(BackgroundPlan.nextProcessing(nextDue: nil, now: now) == now.addingTimeInterval(6 * 3600))
    }
}

@Suite("BackgroundRunner")
@MainActor
struct BackgroundRunnerTests {
    @Test("a finished job is recorded with its counts")
    func completed() async {
        let record = await BackgroundRunner().run(.refresh) { (newMail: 2, alerts: 1) }
        #expect(record.result == .completed)
        #expect(record.newMail == 2)
        #expect(record.alerts == 1)
        #expect(record.kind == .refresh)
    }

    @Test("a failing job records the error code only")
    func failed() async {
        let record = await BackgroundRunner().run(.checkNow) { throw FlintError(.network, "secret host name") }
        #expect(record.result == .failed)
        #expect(record.errorCode == "network")
    }

    @Test("an expired task stops waiting for a stuck job")
    func expired() async {
        let task = Task { @MainActor in
            await BackgroundRunner().run(.refresh) {
                while true { try await Task.sleep(for: .seconds(1)) }
            }
        }
        try? await Task.sleep(for: .milliseconds(50))
        task.cancel()
        let record = await task.value
        #expect(record.result == .expired)
    }
}

@Suite("CodesLogic")
struct CodesLogicTests {
    func code(_ id: String, at: Int, expires: Int, used: Bool = false, value: String = "482913") -> VerificationCode {
        VerificationCode(id: id, code: value, service: "Pocket", senderAddress: "a@b.example", senderDomain: "b.example", threadId: 1, messageId: 1, accountId: "a", receivedAt: at, expiresAt: expires, used: used)
    }

    @Test("expired codes are hidden, unused come first, newest first, capped")
    func visible() {
        let now = 10_000
        let codes = [
            code("old", at: 1, expires: 5_000), code("used", at: 9_000, expires: 20_000, used: true), code("a", at: 8_000, expires: 20_000),
            code("b", at: 9_500, expires: 20_000), code("c", at: 7_000, expires: 20_000), code("d", at: 6_000, expires: 20_000),
        ]
        let shown = CodesLogic.visible(codes, nowMs: now).map(\.id)
        #expect(shown == ["b", "a", "c"])
    }

    @Test("six digits are grouped; other codes are untouched")
    func display() {
        #expect(CodesLogic.display("482913") == "482 913")
        #expect(CodesLogic.display("AB-12CD") == "AB-12CD")
        #expect(CodesLogic.display("4829") == "4829")
    }

    @Test("remaining time rounds up to minutes")
    func remaining() {
        #expect(CodesLogic.remaining(code("x", at: 0, expires: 9 * 60_000 + 1), nowMs: 0) == "10 min left")
        #expect(CodesLogic.remaining(code("x", at: 0, expires: 30_000), nowMs: 0) == "Under a minute left")
    }

    @Test("auto copy needs codes and auto copy on, and an unused code")
    func autoCopy() {
        var settings = Settings.Codes()
        #expect(!CodesLogic.autoCopyCandidate(code("x", at: 0, expires: 1), settings: settings))
        settings.autoCopy = true
        #expect(CodesLogic.autoCopyCandidate(code("x", at: 0, expires: 1), settings: settings))
        #expect(!CodesLogic.autoCopyCandidate(code("x", at: 0, expires: 1, used: true), settings: settings))
        settings.enabled = false
        #expect(!CodesLogic.autoCopyCandidate(code("x", at: 0, expires: 1), settings: settings))
    }
}
