import Foundation
import UserNotifications

/// The notification centre's delegate. A tap or a button comes in here, even when the app was launched by it, and goes to
/// `handler`. Alerts that arrive with the app open are not shown: the inbox and the Codes strip already show that mail.
final class NotificationResponder: NSObject, UNUserNotificationCenterDelegate, @unchecked Sendable {
    private let handler: @Sendable (NotificationRequest) async -> Void

    init(handler: @escaping @Sendable (NotificationRequest) async -> Void) { self.handler = handler }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let info = (response.notification.request.content.userInfo as? [String: String]) ?? [:]
        let request = NotificationRequest.parse(action: response.actionIdentifier, userInfo: info)
        await handler(request)
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        []
    }
}
