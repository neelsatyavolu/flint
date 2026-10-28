import Foundation
import UserNotifications

/// Where Scheduling's local notifications go. Wave 4B owns notification permission, categories and tap handling; it can
/// adopt this protocol (same identifiers, `LocalNotice.userInfo` keys) or keep `UserNotificationScheduler`.
protocol LocalNotificationScheduling: Sendable {
    /// Schedules the notice, replacing one with the same id. `askPermission` lets the first call raise the system prompt:
    /// pass true only when the person just asked for something that depends on it (send later, a follow-up reminder).
    func schedule(_ notice: LocalNotice, askPermission: Bool) async
    func cancel(ids: [String]) async
    /// The notices Scheduling has waiting.
    func pending() async -> [LocalNotice]
}

/// Does nothing. Used for the demo mailbox and tests so no run touches the system notification centre.
struct NoNotifications: LocalNotificationScheduling {
    func schedule(_ notice: LocalNotice, askPermission: Bool) async {}
    func cancel(ids: [String]) async {}
    func pending() async -> [LocalNotice] { [] }
}

/// `UNUserNotificationCenter` with calendar triggers, which fire without the app running. Without permission it stays quiet.
struct UserNotificationScheduler: LocalNotificationScheduling {
    func schedule(_ notice: LocalNotice, askPermission: Bool) async {
        guard notice.fireAt.timeIntervalSinceNow > 1, await isAllowed(askPermission: askPermission) else { return }
        let content = UNMutableNotificationContent()
        content.title = notice.title
        content.body = notice.body
        content.sound = .default
        content.userInfo = notice.userInfo
        if let threadId = notice.threadId { content.threadIdentifier = String(threadId) }
        let parts = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: notice.fireAt)
        let trigger = UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)
        try? await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: notice.id, content: content, trigger: trigger))
    }

    func cancel(ids: [String]) async {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ids)
    }

    func pending() async -> [LocalNotice] {
        await UNUserNotificationCenter.current().pendingNotificationRequests().compactMap { request in
            guard let trigger = request.trigger as? UNCalendarNotificationTrigger, let fireAt = trigger.nextTriggerDate() else { return nil }
            let info = Dictionary(uniqueKeysWithValues: request.content.userInfo.compactMap { key, value -> (String, String)? in
                guard let key = key as? String, let value = value as? String else { return nil }
                return (key, value)
            })
            return LocalNotice(id: request.identifier, title: request.content.title, body: request.content.body, fireAt: fireAt, userInfo: info)
        }
    }

    private func isAllowed(askPermission: Bool) async -> Bool {
        let center = UNUserNotificationCenter.current()
        switch await center.notificationSettings().authorizationStatus {
        case .authorized, .provisional, .ephemeral: return true
        case .notDetermined:
            guard askPermission else { return false }
            return (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        default: return false
        }
    }
}
