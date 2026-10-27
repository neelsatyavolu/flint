@testable import Flint
import FlintModel
import Foundation
import Testing

/// A notification centre that remembers what it was asked.
actor RecordingNotifier: LocalNotificationScheduling {
    private(set) var notices: [String: LocalNotice] = [:]
    private(set) var asked: [String: Bool] = [:]

    func schedule(_ notice: LocalNotice, askPermission: Bool) async {
        notices[notice.id] = notice
        asked[notice.id] = askPermission
    }
    func cancel(ids: [String]) async { for id in ids { notices[id] = nil } }
    func pending() async -> [LocalNotice] { Array(notices.values) }
    func ids() -> Set<String> { Set(notices.keys) }
    func notice(_ id: String) -> LocalNotice? { notices[id] }
    func askedPermission(_ id: String) -> Bool? { asked[id] }
}

@Suite("Time picker kinds")
struct TimePickerKindTests {
    private static let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }()
    private let now = ISO8601DateFormatter().date(from: "2026-10-21T09:10:00Z")!
    private let english = Locale(identifier: "en_US")

    @Test("snooze and send later offer the desktop presets")
    func presets() {
        let snooze = TimePickerKind.snooze.options(now: now, calendar: Self.calendar, locale: english)
        #expect(snooze.map(\.id) == ["later", "tomorrow", "weekend", "nextWeek"])
        #expect(TimePickerKind.sendLater.options(now: now, calendar: Self.calendar, locale: english) == snooze)
    }

    @Test("follow-up presets are 1 day, 3 days and 1 week from now")
    func followUp() {
        let options = TimePickerKind.reminder.options(now: now, calendar: Self.calendar, locale: english)
        #expect(options.map(\.label) == ["1 day", "3 days", "1 week"])
        #expect(options.map { $0.at.timeIntervalSince(now) / 86_400 } == [1, 3, 7])
    }

    @Test("only send later states the iOS limit")
    func footnotes() {
        #expect(TimePickerKind.sendLater.footnote?.hasPrefix("Sends when Flint can run") == true)
        #expect(TimePickerKind.snooze.footnote == nil)
    }

    @Test("the custom picker starts in the future and cannot go back in time")
    func custom() {
        #expect(TimePickerKind.snooze.initialCustom(now: now, calendar: Self.calendar) == now.addingTimeInterval(86_400))
        #expect(TimePickerKind.sendLater.initialCustom(now: now, calendar: Self.calendar) == now.addingTimeInterval(3_600))
        #expect(TimePickerKind.reminder.initialCustom(now: now, calendar: Self.calendar) == now.addingTimeInterval(3 * 86_400))
        for kind in [TimePickerKind.snooze, .sendLater, .reminder] {
            #expect(kind.earliest(now: now) >= now)
            #expect(kind.initialCustom(now: now, calendar: Self.calendar) >= kind.earliest(now: now))
        }
    }
}

@Suite("Reminder timing")
struct ReminderTimingTests {
    @Test("a reminder for a message sent now is left alone")
    func immediate() {
        #expect(ReminderTiming.effective(remindAt: 5_000, sendAt: nil, now: 1_000) == 5_000)
    }

    @Test("a reminder that falls after the scheduled send is left alone")
    func afterSend() {
        #expect(ReminderTiming.effective(remindAt: 9_000, sendAt: 4_000, now: 1_000) == 9_000)
    }

    @Test("a reminder that would fire before the scheduled send keeps its wait, counted from the send")
    func beforeSend() {
        #expect(ReminderTiming.effective(remindAt: 3_000, sendAt: 10_000, now: 1_000) == 12_000)
        #expect(ReminderTiming.effective(remindAt: 10_000, sendAt: 10_000, now: 1_000) == 10_000 + 9_000)
    }
}

@Suite("Scheduling notices")
struct SchedulingNoticeTests {
    private let carla = Address(name: "Carla Mendes", address: "carla@example.com")

    @Test("send later says who it is for and when, without the subject")
    func sendLater() {
        let notice = SchedulingNotices.sendLater(scheduledId: 7, to: [carla], sendAt: 1_800_000_000_000)
        #expect(notice.id == "send-later.7")
        #expect(notice.title == "Ready to send to Carla Mendes")
        #expect(notice.fireAt == Date(timeIntervalSince1970: 1_800_000_000))
        #expect(notice.userInfo["flint.scheduled"] == "7")
    }

    @Test("follow-up and snooze carry their thread for the tap")
    func threads() {
        let follow = SchedulingNotices.followUp(scheduledId: 3, to: [carla], threadId: 1, remindAt: 2_000, sentAt: 1_000)
        #expect(follow.id == "follow-up.3" && follow.threadId == 1 && follow.title == "Any reply from Carla Mendes?")
        let snooze = SchedulingNotices.snooze(threadId: 9, until: 5_000)
        #expect(snooze.id == "snooze.9" && snooze.userInfo["flint.thread"] == "9")
    }

    @Test("a notice survives the round trip through the system's user info")
    func roundTrip() {
        let original = SchedulingNotices.followUp(scheduledId: 3, to: [carla], threadId: 1, remindAt: 2_000, sentAt: 1_000)
        let copy = LocalNotice(id: original.id, title: original.title, body: original.body, fireAt: original.fireAt, userInfo: original.userInfo)
        #expect(copy == original)
        #expect(LocalNotice(id: "x", title: "", body: "", fireAt: .now, userInfo: ["flint.kind": "other"]) == nil)
    }
}

@MainActor
@Suite("Scheduling coordinator")
struct SchedulingCoordinatorTests {
    private let carla = Address(name: "Carla Mendes", address: "carla@example.com")
    private func draft(remindAt: EpochMs? = nil, threadId: ThreadID? = nil) -> Draft {
        Draft(id: 1, accountId: "a", from: "me@example.com", threadId: threadId, to: [carla], remindAt: remindAt)
    }
    private func result(_ id: Int = 4, sendAt: EpochMs, undoUntil: EpochMs = 0) -> SendResult {
        SendResult(scheduledId: id, sendAt: sendAt, undoUntil: undoUntil, status: .pending)
    }

    @Test("send later asks for a notice, with permission; a normal send does not")
    func sendLater() async {
        let notifier = RecordingNotifier()
        let coordinator = SchedulingCoordinator(notifier: notifier)
        await coordinator.sendQueued(result(sendAt: 9_000_000_000_000), draft: draft(), userScheduledAt: 9_000_000_000_000)
        #expect(await notifier.ids() == ["send-later.4"])
        #expect(await notifier.askedPermission("send-later.4") == true)
        await coordinator.sendQueued(result(5, sendAt: 1_000, undoUntil: 6_000), draft: draft(), userScheduledAt: nil)
        #expect(await notifier.ids() == ["send-later.4"])
    }

    @Test("a follow-up reminder is armed for the draft's time, counted from when the message goes out")
    func followUp() async {
        let notifier = RecordingNotifier()
        let coordinator = SchedulingCoordinator(notifier: notifier)
        await coordinator.sendQueued(result(sendAt: 1_000, undoUntil: 6_000), draft: draft(remindAt: 90_000, threadId: 1), userScheduledAt: nil)
        let notice = await notifier.notice("follow-up.4")
        #expect(notice?.fireAt == Date(timeIntervalSince1970: 90) && notice?.threadId == 1 && notice?.sentAt == 6_000)
    }

    @Test("undo and cancel withdraw both notices")
    func cancelled() async {
        let notifier = RecordingNotifier()
        let coordinator = SchedulingCoordinator(notifier: notifier)
        await coordinator.sendQueued(result(sendAt: 9_000_000_000_000), draft: draft(remindAt: 9_100_000_000_000), userScheduledAt: 9_000_000_000_000)
        #expect(await notifier.ids().count == 2)
        await coordinator.sendCancelled(scheduledId: 4)
        #expect(await notifier.ids().isEmpty)
    }

    @Test("a send that left the queue loses its Ready to send notice; the ones still waiting keep theirs")
    func reconcile() async {
        let notifier = RecordingNotifier()
        let coordinator = SchedulingCoordinator(notifier: notifier)
        await coordinator.sendQueued(result(4, sendAt: 9_000_000_000_000), draft: draft(), userScheduledAt: 9_000_000_000_000)
        await coordinator.sendQueued(result(8, sendAt: 9_000_000_000_000), draft: draft(remindAt: 9_100_000_000_000), userScheduledAt: 9_000_000_000_000)
        await coordinator.reconcile(waiting: [ScheduledSend(id: 8, draftId: 1, sendAt: 9_000_000_000_000)])
        #expect(await notifier.ids() == ["send-later.8", "follow-up.8"])
    }

    @Test("a reply from someone else answers the follow-up; your own mail and other threads do not")
    func reply() async {
        let notifier = RecordingNotifier()
        let coordinator = SchedulingCoordinator(notifier: notifier)
        await coordinator.sendQueued(result(sendAt: 1_000, undoUntil: 6_000), draft: draft(remindAt: 9_000_000_000_000, threadId: 1), userScheduledAt: nil)
        let own: Set<String> = ["me@example.com"]
        await coordinator.replyArrived(threadId: 2, from: "carla@example.com", ownAddresses: own, at: 7_000)
        await coordinator.replyArrived(threadId: 1, from: "ME@example.com", ownAddresses: own, at: 7_000)
        await coordinator.replyArrived(threadId: 1, from: "carla@example.com", ownAddresses: own, at: 5_000)
        #expect(await notifier.ids() == ["follow-up.4"])
        await coordinator.replyArrived(threadId: 1, from: "carla@example.com", ownAddresses: own, at: 7_000)
        #expect(await notifier.ids().isEmpty)
    }

    @Test("snooze wake-ups are per conversation and never raise the permission prompt")
    func snooze() async {
        let notifier = RecordingNotifier()
        let coordinator = SchedulingCoordinator(notifier: notifier)
        await coordinator.snoozed([10, 11], until: 9_000_000_000_000)
        #expect(await notifier.ids() == ["snooze.10", "snooze.11"])
        #expect(await notifier.askedPermission("snooze.10") == false)
        await coordinator.unsnoozed([10])
        #expect(await notifier.ids() == ["snooze.11"])
    }

    // MARK: Notification settings

    private func settings(_ change: (inout Settings.Notifications) -> Void) -> Settings.Notifications {
        var value = Settings.Notifications()
        change(&value)
        return value
    }

    @Test("with alerts off nothing is scheduled")
    func alertsOffSchedulesNothing() async {
        let notifier = RecordingNotifier()
        let coordinator = SchedulingCoordinator(notifier: notifier)
        await coordinator.update(notifications: settings { $0.enabled = false })
        await coordinator.sendQueued(result(sendAt: 9_000_000_000_000), draft: draft(remindAt: 9_100_000_000_000), userScheduledAt: 9_000_000_000_000)
        await coordinator.snoozed([10], until: 9_000_000_000_000)
        await coordinator.sendRescheduled(ScheduledSend(id: 4, draftId: 1, sendAt: 9_000_000_000_000))
        #expect(await notifier.ids().isEmpty)
    }

    @Test("switching alerts off withdraws what is waiting")
    func alertsOffWithdraws() async {
        let notifier = RecordingNotifier()
        let coordinator = SchedulingCoordinator(notifier: notifier)
        await coordinator.sendQueued(result(sendAt: 9_000_000_000_000), draft: draft(remindAt: 9_100_000_000_000), userScheduledAt: 9_000_000_000_000)
        await coordinator.snoozed([10], until: 9_000_000_000_000)
        #expect(await notifier.ids().count == 3)
        await coordinator.update(notifications: settings { $0.scope = .none })
        #expect(await notifier.ids().isEmpty)
    }

    @Test("hidden previews keep the recipient out of the title, new and already waiting")
    func hiddenPreviews() async {
        let notifier = RecordingNotifier()
        let coordinator = SchedulingCoordinator(notifier: notifier)
        await coordinator.sendQueued(result(4, sendAt: 9_000_000_000_000), draft: draft(remindAt: 9_100_000_000_000), userScheduledAt: 9_000_000_000_000)
        #expect(await notifier.notice("send-later.4")?.title == "Ready to send to Carla Mendes")
        #expect(await notifier.notice("follow-up.4")?.title == "Any reply from Carla Mendes?")
        await coordinator.update(notifications: settings { $0.preview = .none })
        #expect(await notifier.notice("send-later.4")?.title == "Ready to send")
        #expect(await notifier.notice("follow-up.4")?.title == "Any reply?")
        #expect(await notifier.notice("send-later.4")?.scheduledId == 4)
        await coordinator.sendQueued(result(5, sendAt: 9_000_000_000_000), draft: draft(), userScheduledAt: 9_000_000_000_000)
        #expect(await notifier.notice("send-later.5")?.title == "Ready to send")
    }
}
