@testable import Flint
import FlintModel
import FlintService
import Foundation
import Testing

/// The whole background path on the seeded mailbox: sync, an alert for the new person, a record, the next run armed.
@Suite("BackgroundRun", .serialized)
@MainActor
struct BackgroundRunTests {
    final class Foreground { var value = false }

    func model() async throws -> (AppModel, MemoryNotificationScheduler, RecordingBackgroundTaskScheduling, DemoSeedResult) {
        let seed = try await DemoSeed.make()
        let center = MemoryNotificationScheduler(status: .allowed)
        let foreground = Foreground()
        let coordinator = NotificationCoordinator(center: center, clipboard: MemoryCodeClipboard(), isForeground: { foreground.value }, batchDelay: .milliseconds(10))
        let scheduler = RecordingBackgroundTaskScheduling()
        let defaults = UserDefaults(suiteName: "flint.tests.\(UUID().uuidString)") ?? .standard
        let model = AppModel(mode: .injected(seed.service), defaults: defaults, backgroundTasking: NoBackgroundTasking(), notifications: coordinator, backgroundScheduler: scheduler)
        model.demoDeliverNewMail = seed.deliverNewMail
        return (model, center, scheduler, seed)
    }

    @Test("a refresh run syncs the new person's mail, alerts once, records itself and arms the next run")
    func refreshRun() async throws {
        let (model, center, scheduler, _) = try await model()
        let record = await model.runBackground(.refresh)
        #expect(record.result == .completed)
        #expect(record.newMail == 1)
        #expect(record.alerts == 1)
        #expect(center.posted.count == 1)
        #expect(center.posted.first?.title == "Hannah Brooks")
        #expect(model.diagnostics.last?.id == record.id)
        #expect(scheduler.refreshes.count == 1)
        #expect(scheduler.processings.count == 1)
        await model.shutdown()
    }

    @Test("a second run records a second entry, and check now is recorded as such")
    func twoRuns() async throws {
        let (model, _, _, _) = try await model()
        await model.bootstrap()
        await model.checkNow()
        _ = await model.runBackground(.processing)
        #expect(model.diagnostics.runs.map(\.kind) == [.processing, .checkNow])
        #expect(model.diagnostics.systemRuns.count == 1)
        await model.shutdown()
    }

    @Test("with alerts switched off the run still syncs and records, but posts nothing")
    func alertsOff() async throws {
        let (model, center, _, _) = try await model()
        await model.bootstrap()
        await model.updateSettings(patch: SettingsPatch.object("notifications", "enabled", .bool(false)))
        let record = await model.runBackground(.refresh)
        #expect(record.result == .completed)
        #expect(record.alerts == 0)
        #expect(center.posted.isEmpty)
        await model.shutdown()
    }

    @Test("a warm process that was stopped on the way to the background still detects and announces a code")
    func warmRunDetectsCode() async throws {
        let (model, center, _, seed) = try await model()
        await model.bootstrap()
        await model.service?.stop()
        model.demoDeliverNewMail = seed.deliverCodeMail
        let record = await model.runBackground(.refresh)
        #expect(record.result == .completed)
        #expect(center.posted.contains { $0.identifier.hasPrefix("code.") && $0.title.hasPrefix("Pocket code 61") })
        await model.shutdown()
    }

    @Test("a code alert holds back the same mail's ordinary alert, with no fixed wait")
    func codeAlertCoversTheOrdinaryAlert() async throws {
        let (model, center, _, seed) = try await model()
        await model.bootstrap()
        await model.service?.stop()
        model.demoDeliverNewMail = seed.deliverCodeMail
        let record = await model.runBackground(.refresh)
        #expect(record.result == .completed)
        #expect(center.posted.filter { $0.identifier.hasPrefix("code.") }.count == 1)
        #expect(center.posted.count == 1, "the ordinary new-mail alert for the code mail is suppressed")
        await model.shutdown()
    }

    @Test("waiting for code detection returns at once when settled, polls until it is, and gives up at the cap")
    func settlingWait() async {
        var slept = 0
        #expect(await CodeSettling.wait(sleep: { _ in slept += 1 }, isSettled: { true }))
        #expect(slept == 0)
        var polls = 0
        #expect(await CodeSettling.wait(sleep: { _ in polls += 1 }, isSettled: { polls >= 3 }))
        #expect(polls == 3)
        var capped = 0
        let settled = await CodeSettling.wait(cap: .milliseconds(100), poll: .milliseconds(20), sleep: { _ in capped += 1 }, isSettled: { false })
        #expect(!settled && capped == 5)
    }

    @Test("a background run polls the receipts service after mail")
    func runPollsReceipts() async throws {
        let (model, _, _, _) = try await model()
        var polls = 0
        model.pollReceiptsInBackground = { _ in polls += 1 }
        _ = await model.runBackground(.refresh)
        _ = await model.runBackground(.processing)
        #expect(polls == 2)
        await model.shutdown()
    }

    @Test("after a failed open, the next background run opens the service and works; so does the window")
    func failedBootstrapIsRetried() async throws {
        let (model, _, scheduler, seed) = try await model()
        var attempts = 0
        model.serviceOpener = {
            attempts += 1
            if attempts == 1 { throw FlintError(.internal, "database busy") }
            return seed.service
        }
        let failed = await model.runBackground(.refresh)
        #expect(failed.result == .failed)
        #expect(scheduler.refreshes.count == 1, "the schedule survives a failed open")
        guard case .failed = model.phase else { Issue.record("expected the failed phase"); return }

        let record = await model.runBackground(.refresh)
        #expect(attempts == 2)
        #expect(record.result == .completed)
        #expect(model.phase == .ready)
        await model.shutdown()
    }

    @Test("the window retries a failed open too, and starts sync")
    func windowRetriesFailedOpen() async throws {
        let (model, _, _, seed) = try await model()
        var attempts = 0
        model.serviceOpener = {
            attempts += 1
            if attempts == 1 { throw FlintError(.internal, "database busy") }
            return seed.service
        }
        await model.bootstrapForBackgroundRun()
        guard case .failed = model.phase else { Issue.record("expected the failed phase"); return }
        await model.bootstrap()
        #expect(model.phase == .ready && model.syncStarted && attempts == 2)
        await model.shutdown()
    }

    @Test("a background launch opens the service without sync, and the window's bootstrap starts it")
    func lightBootstrap() async throws {
        let (model, _, _, _) = try await model()
        await model.bootstrapForBackgroundRun()
        #expect(model.phase == .ready)
        #expect(!model.syncStarted)
        await model.bootstrap()
        #expect(model.syncStarted)
        await model.shutdown()
    }

    @Test("the seeded code announces itself as the service and the code")
    func seededCode() async throws {
        let (model, _, _, _) = try await model()
        await model.bootstrap()
        let code = try #require(await model.service?.recentCodes().first)
        let alert = try #require(NotificationPolicy.codeAlert(code, settings: Settings.Codes(), notifications: Settings.Notifications()))
        #expect(alert.title == "Pocket code 482913")
        await model.shutdown()
    }

    @Test("snoozing a conversation plans a notification for its wake time")
    func snoozePlan() async throws {
        let (model, center, _, _) = try await model()
        await model.bootstrap()
        let page = try await model.listThreads(ThreadQuery(view: .inbox, focused: false, limit: 50))
        let target = try #require(page.items.first)
        let until = Int(Date().timeIntervalSince1970 * 1000) + 3_600_000
        _ = try await model.requireService().snooze([target.id], until: until)
        await model.notifications.reconcileDue()
        #expect(center.pending.map(\.identifier).contains("snooze.\(target.id)"))
        await model.shutdown()
    }
}
