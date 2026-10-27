@testable import Flint
import FlintModel
import Foundation
import Testing

@Suite("NotificationPolicy")
struct NotificationPolicyTests {
    static func mail(
        thread: Int = 1, from: String = "Ann", category: MailCategory = .people, subject: String = "Lunch?", snippet: String? = "Noon at the new place",
        forced: Bool = false, account: AccountID = "a1"
    ) -> NewMailInfo {
        NewMailInfo(accountId: account, threadId: thread, from: Address(name: from, address: "\(from.lowercased())@example.com"), subject: subject, category: category, snippet: snippet, forced: forced)
    }

    @Test("people scope alerts for people mail and for forced mail only")
    func peopleScope() {
        let settings = Settings.Notifications()
        #expect(NotificationPolicy.wantsAlert(settings, Self.mail()))
        #expect(!NotificationPolicy.wantsAlert(settings, Self.mail(category: .newsletters)))
        #expect(NotificationPolicy.wantsAlert(settings, Self.mail(category: .notifications, forced: true)))
    }

    @Test("all scope alerts for everything, none and disabled alert for nothing")
    func otherScopes() {
        var settings = Settings.Notifications()
        settings.scope = .all
        #expect(NotificationPolicy.wantsAlert(settings, Self.mail(category: .newsletters)))
        settings.scope = .none
        #expect(!NotificationPolicy.wantsAlert(settings, Self.mail()))
        settings.scope = .all
        settings.enabled = false
        #expect(!NotificationPolicy.wantsAlert(settings, Self.mail()))
    }

    @Test("an account switched off never alerts")
    func disabledAccount() {
        var settings = Settings.Notifications()
        settings.disabledAccounts = ["a1"]
        #expect(NotificationPolicy.alert(for: [Self.mail(account: "a1")], settings: settings) == nil)
        #expect(NotificationPolicy.alert(for: [Self.mail(account: "a2")], settings: settings) != nil)
    }

    @Test("one message shows sender and subject; the line preview adds the first line")
    func singlePreviews() throws {
        var settings = Settings.Notifications()
        let plain = try #require(NotificationPolicy.alert(for: [Self.mail()], settings: settings))
        #expect(plain.title == "Ann")
        #expect(plain.body == "Lunch?")
        #expect(plain.categoryId == NotificationIDs.mailCategory)
        #expect(plain.userInfo[NotificationIDs.Key.threadId] == "1")
        settings.preview = .senderSubjectLine
        let line = try #require(NotificationPolicy.alert(for: [Self.mail()], settings: settings))
        #expect(line.body == "Lunch?\nNoon at the new place")
        settings.preview = .none
        let hidden = try #require(NotificationPolicy.alert(for: [Self.mail()], settings: settings))
        #expect(hidden.title == "New mail")
        #expect(hidden.body == "")
    }

    @Test("a burst in one thread shows the latest message; sound follows the setting")
    func oneThreadBurst() throws {
        var settings = Settings.Notifications()
        settings.sound = false
        let alert = try #require(NotificationPolicy.alert(for: [Self.mail(subject: "First"), Self.mail(subject: "Second")], settings: settings))
        #expect(alert.body == "Second")
        #expect(alert.sound == false)
    }

    @Test("several threads collapse into one summary that replaces the older one")
    func summary() throws {
        let settings = Settings.Notifications()
        let batch = [Self.mail(thread: 1, from: "Ann"), Self.mail(thread: 2, from: "Bo"), Self.mail(thread: 3, from: "Cy"), Self.mail(thread: 4, from: "Di")]
        let alert = try #require(NotificationPolicy.alert(for: batch, settings: settings))
        #expect(alert.title == "4 new messages")
        #expect(alert.body == "From Ann, Bo and 2 others")
        #expect(alert.identifier == NotificationIDs.summaryThread)
        #expect(alert.threadIdentifier == NotificationIDs.summaryThread)
    }

    @Test("unwanted mail in a burst is left out of the summary")
    func summaryFilters() throws {
        let batch = [Self.mail(thread: 1, from: "Ann"), Self.mail(thread: 2, from: "News", category: .newsletters), Self.mail(thread: 3, from: "Bo")]
        let alert = try #require(NotificationPolicy.alert(for: batch, settings: Settings.Notifications()))
        #expect(alert.title == "2 new messages")
        #expect(alert.body == "From Ann and Bo")
    }

    @Test("an empty batch alerts for nothing")
    func empty() {
        #expect(NotificationPolicy.alert(for: [], settings: Settings.Notifications()) == nil)
    }

    @Test("long previews are cut and whitespace is flattened")
    func cutting() {
        let long = String(repeating: "word ", count: 80)
        let cut = NotificationPolicy.cut(long)
        #expect(cut.count <= NotificationPolicy.previewChars + 2)
        #expect(cut.hasSuffix("..."))
        #expect(NotificationPolicy.cut("a\n\n  b") == "a b")
    }

    @Test("a missing sender name falls back to the address, then to Someone")
    func senderNames() {
        let noName = NewMailInfo(accountId: "a", threadId: 1, from: Address(address: "x@example.com"), subject: "", category: .people, snippet: nil, forced: false)
        #expect(NotificationPolicy.sender(noName) == "x@example.com")
        let nobody = NewMailInfo(accountId: "a", threadId: 1, from: Address(address: ""), subject: "", category: .people, snippet: nil, forced: false)
        #expect(NotificationPolicy.sender(nobody) == "Someone")
        let alert = NotificationPolicy.alert(for: [NewMailInfo(accountId: "a", threadId: 1, from: Address(address: "x@example.com"), subject: "  ", category: .people, snippet: nil, forced: false)], settings: Settings.Notifications())
        #expect(alert?.body == "(No subject)")
    }

    // MARK: Codes

    static func code(service: String = "Pocket", value: String = "482913") -> VerificationCode {
        VerificationCode(id: "c1", code: value, service: service, senderAddress: "noreply@pocket-id.example", senderDomain: "pocket-id.example", threadId: 7, messageId: 70, accountId: "a1", receivedAt: 1_000, expiresAt: 1_000 + VerificationCode.ttlMs)
    }

    @Test("a code alert reads the service and the code, and carries the code for Copy code")
    func codeAlert() throws {
        let alert = try #require(NotificationPolicy.codeAlert(Self.code(), settings: Settings.Codes(), notifications: Settings.Notifications()))
        #expect(alert.title == "Pocket code 482913")
        #expect(alert.categoryId == NotificationIDs.codeCategory)
        #expect(alert.userInfo[NotificationIDs.Key.code] == "482913")
        #expect(alert.userInfo[NotificationIDs.Key.codeId] == "c1")
        var quiet = Settings.Notifications()
        quiet.sound = false
        let unnamed = try #require(NotificationPolicy.codeAlert(Self.code(service: " "), settings: Settings.Codes(), notifications: quiet))
        #expect(unnamed.title == "Code 482913")
        #expect(unnamed.sound == false)
    }

    @Test("code alerts are off when codes or their alerts are off")
    func codeAlertOff() {
        var settings = Settings.Codes()
        settings.notify = false
        #expect(NotificationPolicy.codeAlert(Self.code(), settings: settings, notifications: Settings.Notifications()) == nil)
        settings.notify = true
        settings.enabled = false
        #expect(NotificationPolicy.codeAlert(Self.code(), settings: settings, notifications: Settings.Notifications()) == nil)
    }

    @Test("a code never reaches the lock screen when previews are hidden, alerts are off or the account is muted")
    func codeAlertFollowsNotificationSettings() {
        func alert(_ change: (inout Settings.Notifications) -> Void) -> NotificationContent? {
            var notifications = Settings.Notifications()
            change(&notifications)
            return NotificationPolicy.codeAlert(Self.code(), settings: Settings.Codes(), notifications: notifications)
        }
        #expect(alert { _ in } != nil)
        #expect(alert { $0.preview = .none } == nil)
        #expect(alert { $0.enabled = false } == nil)
        #expect(alert { $0.scope = .none } == nil)
        #expect(alert { $0.disabledAccounts = ["a1"] } == nil)
        #expect(alert { $0.disabledAccounts = ["other"] } != nil)
        #expect(alert { $0.preview = .senderSubjectLine } != nil)
    }

    // MARK: Badge, reminders, responses

    @Test("the badge follows the setting and never goes negative")
    func badge() {
        var settings = Settings.Notifications()
        #expect(NotificationPolicy.badgeCount(settings, inboxUnread: 12) == 12)
        #expect(NotificationPolicy.badgeCount(settings, inboxUnread: -1) == 0)
        settings.badge = .off
        #expect(NotificationPolicy.badgeCount(settings, inboxUnread: 12) == 0)
        settings.badge = .unifiedUnread
        settings.enabled = false
        #expect(NotificationPolicy.badgeCount(settings, inboxUnread: 12) == 0)
    }

    @Test("only follow-up toasts become reminder alerts")
    func reminders() {
        let alert = NotificationPolicy.reminderAlert(toast: "No reply from Ann yet", id: "x", settings: Settings.Notifications())
        #expect(alert?.title == "Follow up")
        #expect(alert?.body == "No reply from Ann yet")
        #expect(NotificationPolicy.reminderAlert(toast: "Couldn't send", id: "x", settings: Settings.Notifications()) == nil)
    }

    @Test("a reminder alert keeps the recipient off the lock screen with previews hidden, and follows the alert switches")
    func reminderFollowsNotificationSettings() {
        var settings = Settings.Notifications()
        settings.preview = .none
        let hidden = NotificationPolicy.reminderAlert(toast: "No reply from Ann yet", id: "x", settings: settings)
        #expect(hidden?.body == "")
        #expect(hidden?.title == "Follow up")
        settings.preview = .senderSubject
        settings.enabled = false
        #expect(NotificationPolicy.reminderAlert(toast: "No reply from Ann yet", id: "x", settings: settings) == nil)
        settings.enabled = true
        settings.scope = .none
        #expect(NotificationPolicy.reminderAlert(toast: "No reply from Ann yet", id: "x", settings: settings) == nil)
    }

    @Test("responses map to the right request")
    func responses() {
        let info = [NotificationIDs.Key.threadId: "9", NotificationIDs.Key.code: "123456", NotificationIDs.Key.codeId: "c"]
        #expect(NotificationRequest.parse(action: "com.apple.UNNotificationDefaultActionIdentifier", userInfo: info) == .open(threadId: 9))
        #expect(NotificationRequest.parse(action: NotificationIDs.archiveAction, userInfo: info) == .archive(threadId: 9))
        #expect(NotificationRequest.parse(action: NotificationIDs.markReadAction, userInfo: info) == .markRead(threadId: 9))
        #expect(NotificationRequest.parse(action: NotificationIDs.copyCodeAction, userInfo: info) == .copyCode(code: "123456", codeId: "c"))
        #expect(NotificationRequest.parse(action: NotificationIDs.copyCodeAction, userInfo: [:]) == .openApp)
        #expect(NotificationRequest.parse(action: NotificationIDs.archiveAction, userInfo: [:]) == .openApp)
        #expect(NotificationRequest.parse(action: "x", userInfo: [:]) == .openApp)
        #expect(NotificationRequest.parse(action: "com.apple.UNNotificationDefaultActionIdentifier", userInfo: ["flint.kind": "follow-up", "flint.thread": "12"]) == .open(threadId: 12))
        #expect(NotificationRequest.parse(action: "com.apple.UNNotificationDefaultActionIdentifier", userInfo: ["flint.kind": "send-later", "flint.scheduled": "3"]) == .openApp)
    }
}
