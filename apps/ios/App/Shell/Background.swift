import BackgroundTasks
import FlintModel
import FlintService
import Foundation
import UIKit
import UserNotifications

/// The two task identifiers in Info.plist `BGTaskSchedulerPermittedIdentifiers`.
enum BackgroundTaskID {
    static let refresh = "co.xanom.flint.refresh"
    static let processing = "co.xanom.flint.processing"
}

/// When to ask iOS for the next background run. The system decides the real time; these are the earliest dates we allow.
enum BackgroundPlan {
    static let refreshInterval: TimeInterval = 15 * 60
    static let maintenanceInterval: TimeInterval = 6 * 3600

    static func nextRefresh(now: Date) -> Date { now.addingTimeInterval(refreshInterval) }

    /// A processing run at the next send or snooze that falls due, but never sooner than a minute from now. Without anything
    /// due it is a maintenance slot (re-categorizing, pruning).
    static func nextProcessing(nextDue: EpochMs?, now: Date) -> Date {
        let floor = now.addingTimeInterval(60)
        guard let nextDue else { return now.addingTimeInterval(maintenanceInterval) }
        return max(Date(timeIntervalSince1970: Double(nextDue) / 1000), floor)
    }
}

/// Waits for code detection to finish, with a cap.
enum CodeSettling {
    static let cap: Duration = .seconds(3)
    static let poll: Duration = .milliseconds(20)

    /// Polls `isSettled` until it is true or `cap` passes. Returns whether it settled. A cancelled run stops at once.
    @MainActor
    static func wait(
        cap: Duration = CodeSettling.cap, poll: Duration = CodeSettling.poll,
        sleep: (Duration) async -> Void = { try? await Task.sleep(for: $0) }, isSettled: @MainActor () -> Bool
    ) async -> Bool {
        var waited = Duration.zero
        while !isSettled() {
            guard waited < cap, !Task.isCancelled else { return false }
            await sleep(poll)
            waited += poll
        }
        return true
    }
}

/// `BGTaskScheduler`, behind a protocol so tests can see what was submitted.
@MainActor
protocol BackgroundTaskScheduling: AnyObject {
    func scheduleRefresh(earliest: Date)
    func scheduleProcessing(earliest: Date)
}

@MainActor
final class SystemBackgroundTaskScheduling: BackgroundTaskScheduling {
    func scheduleRefresh(earliest: Date) {
        let request = BGAppRefreshTaskRequest(identifier: BackgroundTaskID.refresh)
        request.earliestBeginDate = earliest
        try? BGTaskScheduler.shared.submit(request)
    }

    func scheduleProcessing(earliest: Date) {
        let request = BGProcessingTaskRequest(identifier: BackgroundTaskID.processing)
        request.earliestBeginDate = earliest
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = false
        try? BGTaskScheduler.shared.submit(request)
    }
}

@MainActor
final class RecordingBackgroundTaskScheduling: BackgroundTaskScheduling {
    private(set) var refreshes: [Date] = []
    private(set) var processings: [Date] = []
    func scheduleRefresh(earliest: Date) { refreshes.append(earliest) }
    func scheduleProcessing(earliest: Date) { processings.append(earliest) }
}

/// Runs one background job, times it, and turns the result into a record. If the surrounding task is cancelled (iOS is about
/// to suspend the app) it stops waiting at once and records `expired`; a stuck network call must not keep the task open.
struct BackgroundRunner: Sendable {
    var now: @Sendable () -> Date = { Date() }

    private enum Outcome: Sendable {
        case done(newMail: Int, alerts: Int)
        case failed(String)
        case expired
    }

    @MainActor
    func run(_ kind: BackgroundRunRecord.Kind, work: @escaping @MainActor () async throws -> (newMail: Int, alerts: Int)) async -> BackgroundRunRecord {
        let started = now()
        let shot = OneShot<Outcome>()
        let outcome = await withTaskCancellationHandler {
            await withCheckedContinuation { (continuation: CheckedContinuation<Outcome, Never>) in
                shot.install(continuation)
                shot.worker = Task { @MainActor in
                    do {
                        let counts = try await work()
                        shot.finish(.done(newMail: counts.newMail, alerts: counts.alerts))
                    } catch is CancellationError {
                        shot.finish(.expired)
                    } catch {
                        shot.finish(.failed((error as? FlintError)?.code.rawValue ?? "unknown"))
                    }
                }
            }
        } onCancel: {
            shot.finish(.expired)
            shot.worker?.cancel()
        }
        let elapsed = Int(now().timeIntervalSince(started) * 1000)
        var record = BackgroundRunRecord(
            id: UUID(), kind: kind, startedAt: started, durationMs: max(elapsed, 0), result: .completed, newMail: 0, alerts: 0, errorCode: nil)
        switch outcome {
        case .done(let newMail, let alerts):
            record.newMail = newMail
            record.alerts = alerts
        case .failed(let code):
            record.result = .failed
            record.errorCode = code
        case .expired:
            record.result = .expired
        }
        return record
    }
}

/// Delivers one value to a continuation exactly once, whichever side gets there first.
private final class OneShot<Value: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Value, Never>?
    private var early: Value?
    private var done = false
    var worker: Task<Void, Never>?

    func install(_ continuation: CheckedContinuation<Value, Never>) {
        lock.lock()
        if let early {
            lock.unlock()
            continuation.resume(returning: early)
        } else {
            self.continuation = continuation
            lock.unlock()
        }
    }

    func finish(_ value: Value) {
        lock.lock()
        guard !done else { lock.unlock(); return }
        done = true
        if let continuation {
            self.continuation = nil
            lock.unlock()
            continuation.resume(returning: value)
        } else {
            early = value
            lock.unlock()
        }
    }
}

/// Reports a background task as finished exactly once, whether the work or the expiration handler gets there first.
final class BackgroundTaskCompletion: @unchecked Sendable {
    private let lock = NSLock()
    private var report: (@Sendable (Bool) -> Void)?

    init(report: @escaping @Sendable (Bool) -> Void) { self.report = report }

    func complete(success: Bool) {
        lock.lock()
        let report = report
        self.report = nil
        lock.unlock()
        report?(success)
    }
}

/// A process-wide model, so a background launch (no window) and the window use the same one, and BGTask handlers registered at
/// launch can reach it.
@MainActor
enum BackgroundHub {
    static let model = AppModel()
    private static var registered = false

    /// Registers both handlers and the notification delegate. Must run before the app finishes launching.
    static func install() {
        guard !registered, !FlintDebugFlags.isHostingUnitTests else { return }
        registered = true
        for (id, kind) in [(BackgroundTaskID.refresh, BackgroundRunRecord.Kind.refresh), (BackgroundTaskID.processing, .processing)] {
            BGTaskScheduler.shared.register(forTaskWithIdentifier: id, using: .main) { task in
                let box = TaskBox(task)
                MainActor.assumeIsolated { handle(box, kind: kind) }
            }
        }
        model.installNotificationDelegate()
    }

    private struct TaskBox: @unchecked Sendable {
        let task: BGTask
        init(_ task: BGTask) { self.task = task }
    }

    private static func handle(_ box: TaskBox, kind: BackgroundRunRecord.Kind) {
        // iOS expects completion right after it calls the expiration handler, so that reports first and stopping the service
        // (which can wait on a network read) comes after.
        let completion = BackgroundTaskCompletion { success in box.task.setTaskCompleted(success: success) }
        let work = Task { @MainActor in
            let record = await model.runBackground(kind)
            completion.complete(success: record.result == .completed)
        }
        box.task.expirationHandler = {
            completion.complete(success: false)
            work.cancel()
        }
    }
}

extension AppModel {
    var isAppActive: Bool { UIApplication.shared.applicationState == .active }

    /// Keeps the app running while `body` works (a sync, a notification action), the same way the send drain does.
    func withBackgroundTask<Result>(_ body: () async -> Result) async -> Result {
        let id = backgroundTasking.begin(expiration: {})
        let result = await body()
        backgroundTasking.end(id)
        return result
    }

    /// Asks iOS for the next refresh and, when something is due, the next processing slot.
    func scheduleBackgroundWork(nextDue: EpochMs?, now: Date = Date()) {
        backgroundScheduler.scheduleRefresh(earliest: BackgroundPlan.nextRefresh(now: now))
        backgroundScheduler.scheduleProcessing(earliest: BackgroundPlan.nextProcessing(nextDue: nextDue, now: now))
    }

    /// One background run: open the service (a cold launch has none yet), sync, run what is due, post the alerts, record it
    /// and arm the next run. The service is stopped again unless the person opened the app meanwhile.
    @discardableResult
    func runBackground(_ kind: BackgroundRunRecord.Kind) async -> BackgroundRunRecord {
        await bootstrapForBackgroundRun()
        guard let service else {
            let failed = BackgroundRunRecord(id: UUID(), kind: kind, startedAt: Date(), durationMs: 0, result: .failed, newMail: 0, alerts: 0, errorCode: "internal")
            recordRun(failed)
            // A failed open must not end the schedule: the next try may find the database ready.
            scheduleBackgroundWork(nextDue: nil)
            return failed
        }
        // A warm process was stopped on the way to the background; code detection and reply watching need their listeners back.
        service.startListeners()
        var nextDue: EpochMs?
        let record = await BackgroundRunner().run(kind) { [self] in
            let counts = try await syncForBackground(service)
            nextDue = await service.runDueWork()
            await pollReceiptsInBackground(service)
            return counts
        }
        recordRun(record)
        scheduleBackgroundWork(nextDue: nextDue)
        if !isAppActive { await service.stop() }
        return record
    }

    /// Sync, then flush the alerts. Shared by the system runs and "Check now".
    private func syncForBackground(_ service: FlintService) async throws -> (newMail: Int, alerts: Int) {
        let tally = notifications.beginRunCount()
        let id = backgroundTasking.begin(expiration: {})
        defer { backgroundTasking.end(id) }
        do {
            if let deliver = demoDeliverNewMail { await deliver() }
            let announcedBefore = service.codeDetection.announced
            let heardBefore = notifications.codeEventsHeard
            try await service.syncNow()
            // Code detection starts when the sync reports new mail. Wait for the scans, and for the app to hear every code they
            // found, so a code alert holds back the thread's ordinary alert. The cap keeps a stuck scan from holding the run.
            _ = await CodeSettling.wait {
                let detection = service.codeDetection
                return detection.running == 0 && notifications.codeEventsHeard - heardBefore >= detection.announced - announcedBefore
            }
            await notifications.settleCodeAlerts()
            await notifications.flush()
            return notifications.endRunCount(tally)
        } catch {
            _ = notifications.endRunCount(tally)
            throw error
        }
    }

    func recordRun(_ record: BackgroundRunRecord) {
        diagnostics = diagnosticsStore.append(record)
    }

    /// "Check now" on the Notifications page: the same sync a background run does, started by hand.
    func checkNow() async {
        let record = await BackgroundRunner().run(.checkNow) { [self] in
            guard let service else { throw FlintError(.internal, "Flint is still starting.") }
            return try await syncForBackground(service)
        }
        recordRun(record)
    }

    // MARK: Notification responses

    func installNotificationDelegate() {
        guard notifications.center is SystemNotificationScheduler else { return }
        let responder = NotificationResponder { request in await BackgroundHub.model.handleNotification(request) }
        notificationResponder = responder
        UNUserNotificationCenter.current().delegate = responder
    }

    /// A tap or a button on a notification. Works on a cold start: the model opens first.
    func handleNotification(_ request: NotificationRequest) async {
        // Archive and Mark read run with the app in the background: no sync sessions for them. Everything else brings the app
        // forward, so it starts as a normal launch.
        if request.runsInBackground { await bootstrapForBackgroundRun() } else { await bootstrap() }
        switch request {
        case .open(let threadId):
            navigate(to: .thread(threadId))
        case .openApp:
            break
        case .archive, .markRead:
            await withBackgroundTask { await notifications.perform(request) }
            if !isAppActive { await service?.stop() }
        case .copyCode:
            // "Copy code" opens the app. It may still read as inactive while a cold launch finishes: never stop sync for it.
            await notifications.perform(request)
        }
    }

    /// The Codes strip: copy, mark used, say so.
    func copyCode(_ code: VerificationCode) async {
        await notifications.copy(code: code.code, codeId: code.id)
    }
}

extension AppModel {
    /// The onboarding switch: on asks iOS for permission once, off turns Flint's alerts off. Both leave the other as it was.
    func applyNotificationChoice(wanted: Bool) async {
        if wanted {
            await notifications.requestPermission()
        } else {
            await updateSettings(patch: SettingsPatch.object("notifications", "enabled", .bool(false)))
        }
    }
}
