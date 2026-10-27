import FlintModel
import Foundation

/// The new mail one alert is about.
struct NewMailInfo: Equatable, Sendable {
    var accountId: AccountID
    var threadId: ThreadID
    var from: Address
    var subject: String
    var category: MailCategory
    var snippet: String?
    var forced: Bool
}

/// When to alert and what the alert says. Port of `packages/core/src/service/notifyPolicy.ts`, plus codes and the badge.
enum NotificationPolicy {
    static let previewChars = 140

    static func wantsAlert(_ settings: Settings.Notifications, _ mail: NewMailInfo) -> Bool {
        guard settings.enabled, settings.scope != .none, !settings.disabledAccounts.contains(mail.accountId) else { return false }
        if settings.scope == .people { return mail.category == .people || mail.forced }
        return true
    }

    /// One alert for a burst. One thread shows its latest message; several threads collapse into "N new messages", which
    /// replaces an older summary. Nil when nothing should alert.
    static func alert(for batch: [NewMailInfo], settings: Settings.Notifications) -> NotificationContent? {
        let wanted = batch.filter { wantsAlert(settings, $0) }
        guard let last = wanted.last else { return nil }
        if Set(wanted.map(\.threadId)).count == 1 { return single(last, settings: settings) }
        return NotificationContent(
            identifier: NotificationIDs.summaryThread,
            title: String(localized: "\(wanted.count) new messages", table: "Notifications"),
            body: settings.preview == .none ? "" : String(localized: "From \(senderList(wanted))", table: "Notifications"),
            categoryId: NotificationIDs.mailCategory, threadIdentifier: NotificationIDs.summaryThread, sound: settings.sound,
            userInfo: [:], fireAt: nil)
    }

    private static func single(_ mail: NewMailInfo, settings: Settings.Notifications) -> NotificationContent {
        let info = [NotificationIDs.Key.threadId: String(mail.threadId), NotificationIDs.Key.accountId: mail.accountId]
        let identifier = "mail.\(mail.threadId)"
        if settings.preview == .none {
            return NotificationContent(
                identifier: identifier, title: String(localized: "New mail", table: "Notifications"), body: "",
                categoryId: NotificationIDs.mailCategory, threadIdentifier: identifier, sound: settings.sound, userInfo: info, fireAt: nil)
        }
        let subject = mail.subject.trimmingCharacters(in: .whitespacesAndNewlines)
        var body = subject.isEmpty ? String(localized: "(No subject)", table: "Notifications") : subject
        if settings.preview == .senderSubjectLine, let snippet = mail.snippet, !snippet.isEmpty { body += "\n" + cut(snippet) }
        return NotificationContent(
            identifier: identifier, title: sender(mail), body: body, categoryId: NotificationIDs.mailCategory,
            threadIdentifier: identifier, sound: settings.sound, userInfo: info, fireAt: nil)
    }

    /// The code alert reads "KAYAK code 530331" on the lock screen. Nil when codes are off or silent.
    static func codeAlert(_ code: VerificationCode, settings: Settings.Codes, sound: Bool) -> NotificationContent? {
        guard settings.enabled, settings.notify else { return nil }
        let service = code.service.trimmingCharacters(in: .whitespaces)
        let title = service.isEmpty
            ? String(localized: "Code \(code.code)", table: "Notifications")
            : String(localized: "\(service) code \(code.code)", table: "Notifications")
        let info = [
            NotificationIDs.Key.threadId: String(code.threadId), NotificationIDs.Key.accountId: code.accountId,
            NotificationIDs.Key.code: code.code, NotificationIDs.Key.codeId: code.id,
        ]
        return NotificationContent(
            identifier: "code.\(code.id)", title: title, body: String(localized: "Tap Copy code to paste it.", table: "Notifications"),
            categoryId: NotificationIDs.codeCategory, threadIdentifier: "codes", sound: sound, userInfo: info, fireAt: nil)
    }

    /// App icon badge: the unified unread count, the people count (not tracked per category yet, so inbox), or nothing.
    static func badgeCount(_ settings: Settings.Notifications, inboxUnread: Int) -> Int {
        guard settings.enabled else { return 0 }
        switch settings.badge {
        case .off: return 0
        case .unifiedUnread, .peopleUnread: return max(inboxUnread, 0)
        }
    }

    static func sender(_ mail: NewMailInfo) -> String {
        let name = mail.from.name.trimmingCharacters(in: .whitespacesAndNewlines)
        if !name.isEmpty { return name }
        return mail.from.address.isEmpty ? String(localized: "Someone", table: "Notifications") : mail.from.address
    }

    /// "Ann", "Ann and Bo", "Ann, Bo and 2 others" over distinct senders in arrival order.
    static func senderList(_ batch: [NewMailInfo]) -> String {
        var names: [String] = []
        for mail in batch where !names.contains(sender(mail)) { names.append(sender(mail)) }
        switch names.count {
        case 0: return ""
        case 1: return names[0]
        case 2: return String(localized: "\(names[0]) and \(names[1])", table: "Notifications")
        default: return String(localized: "\(names[0]), \(names[1]) and \(names.count - 2) others", table: "Notifications")
        }
    }

    static func cut(_ text: String) -> String {
        let flat = text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        guard flat.count > previewChars else { return flat }
        return String(flat.prefix(previewChars - 1)).trimmingCharacters(in: .whitespaces) + "..."
    }

    /// A fired follow-up reminder arrives as an info toast ("No reply from Ann yet"); only those become alerts.
    static func reminderAlert(toast message: String, id: String, sound: Bool) -> NotificationContent? {
        guard message.hasPrefix("No reply from") else { return nil }
        return NotificationContent(
            identifier: "reminder.\(id)", title: String(localized: "Follow up", table: "Notifications"), body: message,
            categoryId: NotificationIDs.reminderCategory, threadIdentifier: "reminders", sound: sound, userInfo: [:], fireAt: nil)
    }
}
