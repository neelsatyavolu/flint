@testable import Flint
import FlintModel
import Foundation
import Testing

@Suite("DueNotificationPlanner")
struct DueNotificationPlannerTests {
    let now = 1_800_000_000_000

    func snoozed(_ id: Int, until: Int?, account: AccountID = "a1") -> ThreadListItem {
        ThreadListItem(id: id, accountId: account, subject: "Contract", snippet: "", participants: [Address(name: "Ann", address: "ann@example.com")], lastDate: now, messageCount: 1, unreadCount: 0, snoozedUntil: until)
    }

    @Test("a future snooze becomes a notification at its wake time, with the same words Scheduling uses")
    func snooze() throws {
        let plan = DueNotificationPlanner.plan(snoozed: [snoozed(5, until: now + 3_600_000)], settings: Settings.Notifications(), nowMs: now)
        let alert = try #require(plan.first)
        let sameAsScheduling = SchedulingNotices.snooze(threadId: 5, until: now + 3_600_000)
        #expect(alert.identifier == sameAsScheduling.id)
        #expect(alert.title == sameAsScheduling.title)
        #expect(alert.body == sameAsScheduling.body)
        #expect(alert.userInfo[NotificationIDs.Key.threadId] == "5")
        #expect(alert.userInfo["flint.thread"] == "5")
        #expect(alert.fireAt == Date(timeIntervalSince1970: Double(now + 3_600_000) / 1000))
    }

    @Test("the wake-up never names the sender or the subject, whatever the preview setting")
    func contentFree() {
        for preview in [Settings.Notifications.Preview.senderSubject, .senderSubjectLine, .none] {
            var settings = Settings.Notifications()
            settings.preview = preview
            let alert = DueNotificationPlanner.plan(snoozed: [snoozed(5, until: now + 5)], settings: settings, nowMs: now).first
            #expect(alert?.body.contains("Ann") == false)
            #expect(alert?.body.contains("Contract") == false)
            #expect(alert?.title.contains("Ann") == false)
        }
    }

    @Test("past or missing wake times plan nothing")
    func skipped() {
        let plan = DueNotificationPlanner.plan(snoozed: [snoozed(1, until: now - 1), snoozed(2, until: nil)], settings: Settings.Notifications(), nowMs: now)
        #expect(plan.isEmpty)
    }

    @Test("alerts off, scope none and a muted account plan nothing")
    func switchedOff() {
        let wake = snoozed(1, until: now + 5)
        var settings = Settings.Notifications()
        settings.enabled = false
        #expect(DueNotificationPlanner.plan(snoozed: [wake], settings: settings, nowMs: now).isEmpty)
        settings.enabled = true
        settings.scope = .none
        #expect(DueNotificationPlanner.plan(snoozed: [wake], settings: settings, nowMs: now).isEmpty)
        settings.scope = .people
        settings.disabledAccounts = ["a1"]
        #expect(DueNotificationPlanner.plan(snoozed: [wake], settings: settings, nowMs: now).isEmpty)
        #expect(DueNotificationPlanner.plan(snoozed: [snoozed(2, until: now + 5, account: "a2")], settings: settings, nowMs: now).count == 1)
    }

    @Test("the plan is sorted and capped")
    func cap() {
        let many = (0..<50).map { snoozed($0, until: now + 1_000 * ($0 + 1)) }
        let plan = DueNotificationPlanner.plan(snoozed: many.reversed(), settings: Settings.Notifications(), nowMs: now)
        #expect(plan.count == DueNotificationPlanner.limit)
        #expect(plan.first?.identifier == "snooze.0")
    }

    @Test("diff removes managed ids that are no longer wanted, old send planner ids included, and leaves the rest alone")
    func diff() {
        let desired = [DueNotificationPlanner.snoozeAlert(snoozed(1, until: now + 5), until: now + 5, sound: true)]
        let result = DueNotificationPlanner.diff(desired: desired, pendingIds: ["snooze.1", "snooze.2", "send.9", "send-later.4", "follow-up.4", "mail.4"])
        #expect(Set(result.remove) == ["snooze.2", "send.9"])
        #expect(result.add.map(\.identifier) == ["snooze.1"])
    }
}
