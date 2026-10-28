@testable import Flint
import FlintModel
import FlintService
import Foundation
import Testing

@Suite("NotificationCoordinator", .serialized)
@MainActor
struct NotificationCoordinatorTests {
    final class Foreground { var value = false }

    func make(status: NotificationAuthorization = .allowed, answer: Bool = true) -> (NotificationCoordinator, MemoryNotificationScheduler, MemoryCodeClipboard, Foreground) {
        let center = MemoryNotificationScheduler(status: status, answer: answer)
        let clipboard = MemoryCodeClipboard()
        let foreground = Foreground()
        let coordinator = NotificationCoordinator(center: center, clipboard: clipboard, isForeground: { foreground.value }, batchDelay: .milliseconds(10))
        return (coordinator, center, clipboard, foreground)
    }

    func newMail(_ thread: Int, from: String = "Ann", category: MailCategory = .people) -> FlintEvent {
        .newMail(accountId: "a1", threadId: thread, from: Address(name: from, address: "x@example.com"), subject: "Hello \(thread)", category: category, snippet: nil, forced: false)
    }

    @Test("new mail in the background posts one alert after the burst settles")
    func backgroundAlert() async throws {
        let (coordinator, center, _, _) = make()
        coordinator.ingest(newMail(1))
        await coordinator.flush()
        #expect(center.posted.count == 1)
        #expect(center.posted.first?.title == "Ann")
        #expect(coordinator.alertsPosted == 1)
    }

    @Test("the batch delay flushes by itself")
    func delayedFlush() async throws {
        let (coordinator, center, _, _) = make()
        coordinator.ingest(newMail(1))
        coordinator.ingest(newMail(2, from: "Bo"))
        try await Task.sleep(for: .milliseconds(200))
        #expect(center.posted.count == 1)
        #expect(center.posted.first?.title == "2 new messages")
    }

    @Test("with the app in the foreground nothing is posted")
    func foregroundQuiet() async {
        let (coordinator, center, _, foreground) = make()
        foreground.value = true
        coordinator.ingest(newMail(1))
        await coordinator.flush()
        #expect(center.posted.isEmpty)
    }

    @Test("without permission nothing is posted")
    func denied() async {
        let (coordinator, center, _, _) = make(status: .denied)
        coordinator.ingest(newMail(1))
        await coordinator.flush()
        #expect(center.posted.isEmpty)
        #expect(coordinator.authorization == .denied)
    }

    @Test("asking for permission follows the system's answer")
    func permission() async {
        let (granted, _, _, _) = make(status: .notDetermined, answer: true)
        #expect(await granted.requestPermission())
        #expect(granted.authorization == .allowed)
        let (refused, _, _, _) = make(status: .notDetermined, answer: false)
        #expect(await refused.requestPermission() == false)
        #expect(refused.authorization == .denied)
    }

    @Test("a code in the background posts its alert")
    func codeAlert() async throws {
        let (coordinator, center, _, _) = make()
        coordinator.ingest(.code(NotificationPolicyTests.code()))
        try await Task.sleep(for: .milliseconds(100))
        #expect(center.posted.first?.title == "Pocket code 482913")
    }

    @Test("a code with the app open is copied when auto copy is on, and not announced")
    func codeAutoCopy() async throws {
        let (coordinator, center, clipboard, foreground) = make()
        foreground.value = true
        var settings = Settings.default
        settings.codes.autoCopy = true
        coordinator.update(settings: settings)
        coordinator.ingest(.code(NotificationPolicyTests.code()))
        try await Task.sleep(for: .milliseconds(100))
        #expect(clipboard.copied == ["482913"])
        #expect(center.posted.isEmpty)
    }

    @Test("a code with auto copy off is left alone")
    func codeNoAutoCopy() async throws {
        let (coordinator, _, clipboard, foreground) = make()
        foreground.value = true
        coordinator.ingest(.code(NotificationPolicyTests.code()))
        try await Task.sleep(for: .milliseconds(100))
        #expect(clipboard.copied.isEmpty)
    }

    @Test("Copy code from a cold start copies without a service")
    func copyCold() async {
        let (coordinator, _, clipboard, _) = make()
        var told = 0
        coordinator.onCopied = { told += 1 }
        await coordinator.perform(.copyCode(code: "123456", codeId: "c1"))
        #expect(clipboard.copied == ["123456"])
        #expect(told == 1)
    }

    @Test("a fired follow-up reminder becomes an alert in the background only")
    func reminderToast() async throws {
        let (coordinator, center, _, foreground) = make()
        foreground.value = true
        coordinator.ingest(.toast(.info, message: "No reply from Ann yet", undoToken: nil))
        try await Task.sleep(for: .milliseconds(50))
        #expect(center.posted.isEmpty)
        foreground.value = false
        coordinator.ingest(.toast(.info, message: "No reply from Ann yet", undoToken: nil))
        try await Task.sleep(for: .milliseconds(100))
        #expect(center.posted.count == 1)
    }

    @Test("run counting reports conversations and alerts, even in the foreground")
    func runCounting() async {
        let (coordinator, _, _, _) = make()
        let run = coordinator.beginRunCount()
        coordinator.ingest(newMail(1))
        coordinator.ingest(newMail(1))
        coordinator.ingest(newMail(2, from: "Bo"))
        await coordinator.flush()
        let counts = coordinator.endRunCount(run)
        #expect(counts.newMail == 2)
        #expect(counts.alerts == 1)
    }

    @Test("overlapping runs keep their own counts")
    func overlappingRuns() async {
        let (coordinator, _, _, _) = make()
        let refresh = coordinator.beginRunCount()
        coordinator.ingest(newMail(1))
        let checkNow = coordinator.beginRunCount()
        coordinator.ingest(newMail(2, from: "Bo"))
        await coordinator.flush()
        let first = coordinator.endRunCount(refresh)
        coordinator.ingest(newMail(3, from: "Cy"))
        let second = coordinator.endRunCount(checkNow)
        #expect(first.newMail == 2)
        #expect(second.newMail == 2)
        #expect(first.alerts == 1)
        #expect(second.alerts == 1)
        #expect(coordinator.endRunCount(refresh) == (0, 0))
    }

    @Test("a code alert covers the ordinary new-mail alert for its thread")
    func codeCoversMailAlert() async throws {
        let (coordinator, center, _, _) = make()
        coordinator.ingest(newMail(7, from: "Pocket"))
        coordinator.ingest(.code(NotificationPolicyTests.code()))
        try await Task.sleep(for: .milliseconds(100))
        await coordinator.flush()
        #expect(center.posted.map(\.identifier) == ["code.c1"])
    }

    @Test("mail in another thread still alerts next to a code alert")
    func codeDoesNotCoverOtherThreads() async throws {
        let (coordinator, center, _, _) = make()
        coordinator.ingest(.code(NotificationPolicyTests.code()))
        try await Task.sleep(for: .milliseconds(100))
        coordinator.ingest(newMail(8, from: "Ann"))
        await coordinator.flush()
        #expect(Set(center.posted.map(\.identifier)) == ["code.c1", "mail.8"])
    }

    @Test("when the code alert is not allowed, the ordinary alert still shows")
    func suppressedCodeCoversNothing() async throws {
        let (coordinator, center, _, _) = make()
        var settings = Settings.default
        settings.notifications.preview = .none
        coordinator.update(settings: settings)
        coordinator.ingest(newMail(7, from: "Pocket"))
        coordinator.ingest(.code(NotificationPolicyTests.code()))
        try await Task.sleep(for: .milliseconds(100))
        await coordinator.flush()
        #expect(center.posted.map(\.identifier) == ["mail.7"])
        #expect(center.posted.first?.title == "New mail")
    }

    @Test("a code with hidden previews, alerts off or a muted account posts nothing")
    func codeFollowsSettings() async throws {
        for change in [{ (s: inout Settings) in s.notifications.preview = .none }, { $0.notifications.enabled = false }, { $0.notifications.disabledAccounts = ["a1"] }] {
            let (coordinator, center, _, _) = make()
            var settings = Settings.default
            change(&settings)
            coordinator.update(settings: settings)
            coordinator.ingest(.code(NotificationPolicyTests.code()))
            try await Task.sleep(for: .milliseconds(60))
            #expect(center.posted.isEmpty)
        }
    }

    @Test("auto copy leaves a code off the clipboard when previews are hidden")
    func autoCopyHiddenPreview() async throws {
        let (coordinator, _, clipboard, foreground) = make()
        foreground.value = true
        var settings = Settings.default
        settings.codes.autoCopy = true
        settings.notifications.preview = .none
        coordinator.update(settings: settings)
        coordinator.ingest(.code(NotificationPolicyTests.code()))
        try await Task.sleep(for: .milliseconds(60))
        #expect(clipboard.copied.isEmpty)
    }

    @Test("a follow-up reminder with hidden previews does not name the recipient")
    func reminderHidden() async throws {
        let (coordinator, center, _, _) = make()
        var settings = Settings.default
        settings.notifications.preview = .none
        coordinator.update(settings: settings)
        coordinator.ingest(.toast(.info, message: "No reply from Ann yet", undoToken: nil))
        try await Task.sleep(for: .milliseconds(80))
        #expect(center.posted.first?.body == "")
    }

    @Test("the badge is set from the unread count when allowed")
    func badge() async {
        let (coordinator, center, _, _) = make()
        await coordinator.updateBadge(inboxUnread: 7)
        #expect(center.badge == 7)
    }

    @Test("categories are registered when a service is attached")
    func categories() async throws {
        let app = try await SeededApp.make()
        let (coordinator, center, _, _) = make()
        coordinator.attach(service: app.seed.service)
        #expect(center.categoriesRegistered)
        await app.tearDown()
    }
}
