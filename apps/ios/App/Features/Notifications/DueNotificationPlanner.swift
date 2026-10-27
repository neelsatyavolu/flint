import FlintModel
import Foundation

/// The local notifications that must exist for snoozed conversations and scheduled sends, so they fire with the app closed.
/// The planner is pure: the coordinator compares its answer with what is pending and adds or removes the difference.
enum DueNotificationPlanner {
    /// iOS keeps at most 64 pending local notifications per app; stay well under it.
    static let limit = 30
    /// A send due within this long is inside its undo window, not "send later".
    static let undoWindowMs = 60_000

    static func plan(
        snoozed: [ThreadListItem], scheduled: [ScheduledSend], settings: Settings.Notifications, nowMs: EpochMs
    ) -> [NotificationContent] {
        guard settings.enabled else { return [] }
        var out: [NotificationContent] = []
        for thread in snoozed {
            guard let until = thread.snoozedUntil, until > nowMs else { continue }
            out.append(snoozeAlert(thread, until: until, sound: settings.sound))
        }
        for send in scheduled where send.status == .pending && send.sendAt > nowMs + undoWindowMs {
            out.append(sendAlert(send, sound: settings.sound))
        }
        return Array(out.sorted { ($0.fireAt ?? .distantFuture) < ($1.fireAt ?? .distantFuture) }.prefix(limit))
    }

    static func snoozeAlert(_ thread: ThreadListItem, until: EpochMs, sound: Bool) -> NotificationContent {
        let who = thread.participants.last.map { NotificationPolicy.sender(NewMailInfo(
            accountId: thread.accountId, threadId: thread.id, from: $0, subject: "", category: .people, snippet: nil, forced: false)) }
            ?? String(localized: "Someone", table: "Notifications")
        let subject = thread.subject.trimmingCharacters(in: .whitespacesAndNewlines)
        return NotificationContent(
            identifier: NotificationIDs.snoozePrefix + String(thread.id), title: String(localized: "Back in your inbox", table: "Notifications"),
            body: subject.isEmpty ? who : "\(who): \(subject)", categoryId: NotificationIDs.mailCategory,
            threadIdentifier: "snoozed", sound: sound,
            userInfo: [NotificationIDs.Key.threadId: String(thread.id), NotificationIDs.Key.accountId: thread.accountId],
            fireAt: Date(timeIntervalSince1970: Double(until) / 1000))
    }

    /// A send that falls due while the app is not running waits for a tap ("Ready to send to Carla").
    static func sendAlert(_ send: ScheduledSend, sound: Bool) -> NotificationContent {
        let to = send.to.first.map { $0.name.isEmpty ? $0.address : $0.name } ?? String(localized: "your recipient", table: "Notifications")
        return NotificationContent(
            identifier: NotificationIDs.sendPrefix + String(send.id), title: String(localized: "Ready to send to \(to)", table: "Notifications"),
            body: String(localized: "Open Flint to send it. Flint sends scheduled mail when it can run.", table: "Notifications"),
            categoryId: NotificationIDs.reminderCategory, threadIdentifier: "scheduled-sends", sound: sound, userInfo: [:],
            fireAt: Date(timeIntervalSince1970: Double(send.sendAt) / 1000))
    }

    /// Which pending ids to remove and which contents to add, given what is pending now.
    static func diff(desired: [NotificationContent], pendingIds: [String]) -> (remove: [String], add: [NotificationContent]) {
        let wanted = Set(desired.map(\.identifier))
        let managed = pendingIds.filter { $0.hasPrefix(NotificationIDs.snoozePrefix) || $0.hasPrefix(NotificationIDs.sendPrefix) }
        let remove = managed.filter { !wanted.contains($0) }
        return (remove, desired)
    }
}
