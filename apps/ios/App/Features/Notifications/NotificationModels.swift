import FlintModel
import Foundation

/// One local notification, described without any UserNotifications types so it can be built and checked in tests.
struct NotificationContent: Equatable, Sendable {
    var identifier: String
    var title: String
    var body: String
    var categoryId: String
    /// Notifications with the same thread identifier stack together on the lock screen.
    var threadIdentifier: String?
    var sound: Bool
    var userInfo: [String: String]
    /// Nil means now.
    var fireAt: Date?
}

enum NotificationAuthorization: Equatable, Sendable {
    case notDetermined
    case denied
    case allowed
}

/// Identifiers shared by the categories, the content builders and the response parser.
enum NotificationIDs {
    static let mailCategory = "co.xanom.flint.category.mail"
    static let codeCategory = "co.xanom.flint.category.code"
    static let reminderCategory = "co.xanom.flint.category.reminder"
    static let archiveAction = "co.xanom.flint.action.archive"
    static let markReadAction = "co.xanom.flint.action.markRead"
    static let copyCodeAction = "co.xanom.flint.action.copyCode"

    static let summaryThread = "new-mail-summary"
    static let snoozePrefix = "snooze."
    static let sendPrefix = "send."

    enum Key {
        static let threadId = "threadId"
        static let accountId = "accountId"
        static let code = "code"
        static let codeId = "codeId"
    }
}

/// What a tap on a notification or one of its buttons asks the app to do.
enum NotificationRequest: Equatable, Sendable {
    case open(threadId: ThreadID)
    case archive(threadId: ThreadID)
    case markRead(threadId: ThreadID)
    case copyCode(code: String, codeId: String?)
    /// A tap on a notification that carries no thread (a scheduled send, a summary): just open the app.
    case openApp

    /// Parses a delivered response. Unknown actions fall back to opening the thread when there is one.
    static func parse(action: String, userInfo: [String: String]) -> NotificationRequest {
        // Scheduling's local notices (4D) carry the thread under `flint.thread`.
        let thread = (userInfo[NotificationIDs.Key.threadId] ?? userInfo["flint.thread"]).flatMap { Int($0) }
        switch action {
        case NotificationIDs.copyCodeAction:
            guard let code = userInfo[NotificationIDs.Key.code], !code.isEmpty else { return .openApp }
            return .copyCode(code: code, codeId: userInfo[NotificationIDs.Key.codeId])
        case NotificationIDs.archiveAction:
            return thread.map { .archive(threadId: $0) } ?? .openApp
        case NotificationIDs.markReadAction:
            return thread.map { .markRead(threadId: $0) } ?? .openApp
        default:
            return thread.map { .open(threadId: $0) } ?? .openApp
        }
    }
}
