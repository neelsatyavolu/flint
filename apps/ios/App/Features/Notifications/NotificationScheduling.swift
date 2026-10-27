import FlintModel
import Foundation
import UserNotifications

/// The slice of the notification centre Flint uses. The system implementation talks to UserNotifications; tests and
/// `-FlintFakeNotifications` use the in-memory one, so no run ever shows a real alert or permission prompt by accident.
@MainActor
protocol NotificationScheduling: AnyObject {
    func authorization() async -> NotificationAuthorization
    func requestAuthorization() async -> Bool
    func registerCategories()
    func post(_ content: NotificationContent) async
    func pendingIdentifiers() async -> [String]
    func removePending(_ identifiers: [String]) async
    func removeDelivered(threadId: ThreadID) async
    func setBadge(_ count: Int) async
}

@MainActor
final class SystemNotificationScheduler: NotificationScheduling {
    private let center = UNUserNotificationCenter.current()

    func authorization() async -> NotificationAuthorization {
        switch await center.notificationSettings().authorizationStatus {
        case .notDetermined: .notDetermined
        case .denied: .denied
        default: .allowed
        }
    }

    func requestAuthorization() async -> Bool {
        (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
    }

    func registerCategories() { center.setNotificationCategories(NotificationCategories.all()) }

    func post(_ content: NotificationContent) async {
        let body = UNMutableNotificationContent()
        body.title = content.title
        body.body = content.body
        body.categoryIdentifier = content.categoryId
        if let thread = content.threadIdentifier { body.threadIdentifier = thread }
        if content.sound { body.sound = .default }
        body.userInfo = content.userInfo
        let trigger = content.fireAt.map {
            UNCalendarNotificationTrigger(dateMatching: Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: $0), repeats: false)
        }
        try? await center.add(UNNotificationRequest(identifier: content.identifier, content: body, trigger: trigger))
    }

    func pendingIdentifiers() async -> [String] { await center.pendingNotificationRequests().map(\.identifier) }
    func removePending(_ identifiers: [String]) async { center.removePendingNotificationRequests(withIdentifiers: identifiers) }

    func removeDelivered(threadId: ThreadID) async {
        let ids = await center.deliveredNotifications().filter { $0.request.content.userInfo[NotificationIDs.Key.threadId] as? String == String(threadId) }
            .map(\.request.identifier)
        center.removeDeliveredNotifications(withIdentifiers: ids)
    }

    func setBadge(_ count: Int) async { try? await center.setBadgeCount(count) }
}

/// Records what would have been shown. Permission answers come from `answer`.
@MainActor
final class MemoryNotificationScheduler: NotificationScheduling {
    private(set) var status: NotificationAuthorization
    private let answer: Bool
    private(set) var posted: [NotificationContent] = []
    private(set) var pending: [NotificationContent] = []
    private(set) var badge = 0
    private(set) var categoriesRegistered = false
    private(set) var removedDelivered: [ThreadID] = []

    init(status: NotificationAuthorization = .allowed, answer: Bool = true) {
        self.status = status
        self.answer = answer
    }

    func authorization() async -> NotificationAuthorization { status }

    func requestAuthorization() async -> Bool {
        status = answer ? .allowed : .denied
        return answer
    }

    func registerCategories() { categoriesRegistered = true }

    func post(_ content: NotificationContent) async {
        guard status == .allowed else { return }
        if content.fireAt != nil {
            pending.removeAll { $0.identifier == content.identifier }
            pending.append(content)
        } else {
            posted.removeAll { $0.identifier == content.identifier }
            posted.append(content)
        }
    }

    func pendingIdentifiers() async -> [String] { pending.map(\.identifier) }
    func removePending(_ identifiers: [String]) async { pending.removeAll { identifiers.contains($0.identifier) } }
    func removeDelivered(threadId: ThreadID) async { removedDelivered.append(threadId) }
    func setBadge(_ count: Int) async { badge = count }
}

/// The three categories and their buttons. Copy code opens the app: writing the pasteboard from a background action is not
/// dependable (DESIGN-NOTES section 9).
enum NotificationCategories {
    static func all() -> Set<UNNotificationCategory> {
        let archive = UNNotificationAction(identifier: NotificationIDs.archiveAction, title: String(localized: "Archive", table: "Notifications"), options: [])
        let markRead = UNNotificationAction(identifier: NotificationIDs.markReadAction, title: String(localized: "Mark read", table: "Notifications"), options: [])
        let copy = UNNotificationAction(identifier: NotificationIDs.copyCodeAction, title: String(localized: "Copy code", table: "Notifications"), options: [.foreground])
        return [
            UNNotificationCategory(identifier: NotificationIDs.mailCategory, actions: [archive, markRead], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: NotificationIDs.codeCategory, actions: [copy], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: NotificationIDs.reminderCategory, actions: [], intentIdentifiers: [], options: []),
        ]
    }
}
