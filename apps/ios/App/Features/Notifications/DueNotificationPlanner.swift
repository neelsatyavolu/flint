import FlintModel
import Foundation

/// The local notifications that must exist for snoozed conversations, so they fire with the app closed. The planner is pure:
/// the coordinator compares its answer with what is pending and adds or removes the difference.
///
/// Scheduling (4D) owns the content of the snooze, send-later and follow-up notices (`SchedulingNotices`); this planner builds
/// a snooze with the same builder, so the two never disagree about an identifier. It does not plan scheduled sends at all:
/// Scheduling's `send-later.<id>` is the one "Ready to send" notice.
enum DueNotificationPlanner {
    /// iOS keeps at most 64 pending local notifications per app; stay well under it.
    static let limit = 30

    static func plan(snoozed: [ThreadListItem], settings: Settings.Notifications, nowMs: EpochMs) -> [NotificationContent] {
        var out: [NotificationContent] = []
        for thread in snoozed {
            guard let until = thread.snoozedUntil, until > nowMs,
                  NotificationPolicy.alertsAllowed(settings, account: thread.accountId) else { continue }
            out.append(snoozeAlert(thread, until: until, sound: settings.sound))
        }
        return Array(out.sorted { ($0.fireAt ?? .distantFuture) < ($1.fireAt ?? .distantFuture) }.prefix(limit))
    }

    /// Same title, body and identifier as Scheduling's snooze notice: nothing about the conversation, since the lock screen
    /// shows it whatever the preview setting says.
    static func snoozeAlert(_ thread: ThreadListItem, until: EpochMs, sound: Bool) -> NotificationContent {
        let notice = SchedulingNotices.snooze(threadId: thread.id, until: until)
        var info = notice.userInfo
        info[NotificationIDs.Key.threadId] = String(thread.id)
        info[NotificationIDs.Key.accountId] = thread.accountId
        return NotificationContent(
            identifier: notice.id, title: notice.title, body: notice.body, categoryId: NotificationIDs.mailCategory,
            threadIdentifier: String(thread.id), sound: sound, userInfo: info, fireAt: notice.fireAt)
    }

    /// Which pending ids to remove and which contents to add, given what is pending now. Ids from the old send planner
    /// (`send.`) are removed whenever they are found.
    static func diff(desired: [NotificationContent], pendingIds: [String]) -> (remove: [String], add: [NotificationContent]) {
        let wanted = Set(desired.map(\.identifier))
        let managed = pendingIds.filter { $0.hasPrefix(NotificationIDs.snoozePrefix) || $0.hasPrefix(NotificationIDs.sendPrefix) }
        let remove = managed.filter { !wanted.contains($0) }
        return (remove, desired)
    }
}
