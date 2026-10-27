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
        coordinator.beginRunCount()
        coordinator.ingest(newMail(1))
        coordinator.ingest(newMail(1))
        coordinator.ingest(newMail(2, from: "Bo"))
        await coordinator.flush()
        let counts = coordinator.endRunCount()
        #expect(counts.newMail == 2)
        #expect(counts.alerts == 1)
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
