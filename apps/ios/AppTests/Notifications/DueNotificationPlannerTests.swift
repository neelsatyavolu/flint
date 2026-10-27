@testable import Flint
import FlintModel
import Foundation
import Testing

@Suite("DueNotificationPlanner")
struct DueNotificationPlannerTests {
    let now = 1_800_000_000_000

    func snoozed(_ id: Int, until: Int?) -> ThreadListItem {
        ThreadListItem(id: id, accountId: "a1", subject: "Contract", snippet: "", participants: [Address(name: "Ann", address: "ann@example.com")], lastDate: now, messageCount: 1, unreadCount: 0, snoozedUntil: until)
    }

    func send(_ id: Int, at: Int, status: ScheduledSendStatus = .pending) -> ScheduledSend {
        ScheduledSend(id: id, draftId: id, subject: "Hi", to: [Address(name: "Carla", address: "carla@example.com")], sendAt: at, status: status)
    }

    @Test("a future snooze becomes a notification at its wake time")
    func snooze() throws {
        let plan = DueNotificationPlanner.plan(snoozed: [snoozed(5, until: now + 3_600_000)], scheduled: [], settings: Settings.Notifications(), nowMs: now)
        let alert = try #require(plan.first)
        #expect(alert.identifier == "snooze.5")
        #expect(alert.title == "Back in your inbox")
        #expect(alert.body == "Ann: Contract")
        #expect(alert.userInfo[NotificationIDs.Key.threadId] == "5")
        #expect(alert.fireAt == Date(timeIntervalSince1970: Double(now + 3_600_000) / 1000))
    }

    @Test("past or missing wake times, and sends inside the undo window, plan nothing")
    func skipped() {
        let plan = DueNotificationPlanner.plan(
            snoozed: [snoozed(1, until: now - 1), snoozed(2, until: nil)],
            scheduled: [send(1, at: now + 10_000), send(2, at: now + 3_600_000, status: .sent)],
            settings: Settings.Notifications(), nowMs: now)
        #expect(plan.isEmpty)
    }

    @Test("a send later becomes a Ready to send notification")
    func scheduledSend() throws {
        let plan = DueNotificationPlanner.plan(snoozed: [], scheduled: [send(3, at: now + 7_200_000)], settings: Settings.Notifications(), nowMs: now)
        let alert = try #require(plan.first)
        #expect(alert.identifier == "send.3")
        #expect(alert.title == "Ready to send to Carla")
    }

    @Test("alerts off plans nothing, and the plan is sorted and capped")
    func offAndCap() {
        var settings = Settings.Notifications()
        let many = (0..<50).map { snoozed($0, until: now + 1_000 * ($0 + 1)) }
        let plan = DueNotificationPlanner.plan(snoozed: many.reversed(), scheduled: [], settings: settings, nowMs: now)
        #expect(plan.count == DueNotificationPlanner.limit)
        #expect(plan.first?.identifier == "snooze.0")
        settings.enabled = false
        #expect(DueNotificationPlanner.plan(snoozed: many, scheduled: [], settings: settings, nowMs: now).isEmpty)
    }

    @Test("diff removes managed ids that are no longer wanted and leaves other notifications alone")
    func diff() {
        let desired = [DueNotificationPlanner.snoozeAlert(snoozed(1, until: now + 5), until: now + 5, sound: true)]
        let result = DueNotificationPlanner.diff(desired: desired, pendingIds: ["snooze.1", "snooze.2", "send.9", "mail.4"])
        #expect(Set(result.remove) == ["snooze.2", "send.9"])
        #expect(result.add.map(\.identifier) == ["snooze.1"])
    }
}
