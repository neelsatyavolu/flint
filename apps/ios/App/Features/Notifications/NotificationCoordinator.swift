import FlintModel
import FlintService
import Foundation
import Observation
import UIKit

/// Turns service events into local notifications and runs what the buttons on them ask for. It does not own the service: the
/// app model hands one over with `attach(service:)`. With the app in the foreground nothing is posted (the inbox and the
/// Codes strip already show it); a background run flushes its alerts before it reports back.
@MainActor @Observable
final class NotificationCoordinator {
    private(set) var authorization: NotificationAuthorization = .notDetermined
    /// Alerts posted since launch (for diagnostics and tests).
    private(set) var alertsPosted = 0

    @ObservationIgnored let center: any NotificationScheduling
    @ObservationIgnored let clipboard: any CodeClipboard
    @ObservationIgnored private let isForeground: @MainActor () -> Bool
    @ObservationIgnored private let nowMs: @Sendable () -> EpochMs
    @ObservationIgnored private let batchDelay: Duration
    @ObservationIgnored private weak var service: FlintService?
    @ObservationIgnored private var notifySettings = Settings.Notifications()
    @ObservationIgnored private var codeSettings = Settings.Codes()
    @ObservationIgnored private var batch: [NewMailInfo] = []
    @ObservationIgnored private var batchTask: Task<Void, Never>?
    @ObservationIgnored private var dueTask: Task<Void, Never>?
    /// What each background run in progress has seen. Runs can overlap (a refresh, a processing run, "Check now"), so each
    /// has its own tally, keyed by the token `beginRunCount` returned.
    @ObservationIgnored private var runs: [UUID: RunTally] = [:]
    /// Threads a code alert was just posted for, with the time. Their ordinary new-mail alert would only repeat it.
    @ObservationIgnored private var codeAlertedAt: [ThreadID: EpochMs] = [:]
    /// `.code` events heard so far, and the tasks acting on them. A background run waits for both before it flushes, so a code
    /// alert is known (and the thread's ordinary alert held back) by then.
    @ObservationIgnored private(set) var codeEventsHeard = 0
    @ObservationIgnored private var codeTasks: [Task<Void, Never>] = []
    @ObservationIgnored var onCopied: @MainActor () -> Void = {}

    private struct RunTally {
        var threads: Set<ThreadID> = []
        var alerts = 0
    }

    /// As on the desktop (`ALERT_COVER_MS` in `codes.ts`): a code alert covers the thread's new-mail alert for this long.
    static let codeCoverMs = 10_000

    init(
        center: any NotificationScheduling, clipboard: any CodeClipboard, isForeground: @escaping @MainActor () -> Bool,
        nowMs: @escaping @Sendable () -> EpochMs = { EpochMs(Date().timeIntervalSince1970 * 1000) },
        batchDelay: Duration = .milliseconds(1500)
    ) {
        self.center = center
        self.clipboard = clipboard
        self.isForeground = isForeground
        self.nowMs = nowMs
        self.batchDelay = batchDelay
    }

    // MARK: Setup

    func attach(service: FlintService) {
        self.service = service
        center.registerCategories()
        Task { await refreshAuthorization() }
    }

    func update(settings: Settings) {
        notifySettings = settings.notifications
        codeSettings = settings.codes
        scheduleDueReconcile()
    }

    func refreshAuthorization() async { authorization = await center.authorization() }

    /// Asks the system for permission. Returns whether alerts are allowed afterwards.
    @discardableResult
    func requestPermission() async -> Bool {
        _ = await center.requestAuthorization()
        await refreshAuthorization()
        return authorization == .allowed
    }

    // MARK: Events

    func ingest(_ event: FlintEvent) {
        switch event {
        case .newMail(let accountId, let threadId, let from, let subject, let category, let snippet, let forced):
            for token in runs.keys { runs[token]?.threads.insert(threadId) }
            guard !isForeground() else { return }
            batch.append(NewMailInfo(accountId: accountId, threadId: threadId, from: from, subject: subject, category: category, snippet: snippet, forced: forced))
            scheduleFlush()
        case .code(let code):
            codeEventsHeard += 1
            codeTasks.append(Task { await handle(code: code) })
        case .toast(_, let message, _):
            guard !isForeground(), let content = NotificationPolicy.reminderAlert(toast: message, id: UUID().uuidString, settings: notifySettings) else { return }
            Task { await post(content) }
        case .mailChanged, .send, .settings:
            scheduleDueReconcile()
        case .sync, .receipt:
            break
        }
    }

    private func handle(code: VerificationCode) async {
        if isForeground() {
            if CodesLogic.autoCopyCandidate(code, settings: codeSettings, notifications: notifySettings) { await copy(code: code.code, codeId: code.id) }
            return
        }
        guard let content = NotificationPolicy.codeAlert(code, settings: codeSettings, notifications: notifySettings) else { return }
        codeAlertedAt[code.threadId] = nowMs()
        await post(content)
    }

    /// Waits until every code heard so far has been turned into an alert (or dropped by the settings).
    func settleCodeAlerts() async {
        let tasks = codeTasks
        codeTasks = []
        for task in tasks { await task.value }
    }

    private func scheduleFlush() {
        batchTask?.cancel()
        batchTask = Task { [batchDelay] in
            try? await Task.sleep(for: batchDelay)
            guard !Task.isCancelled else { return }
            await flush()
        }
    }

    /// Posts the alert for the mail collected so far. A background run calls this before it finishes.
    func flush() async {
        batchTask?.cancel()
        let now = nowMs()
        codeAlertedAt = codeAlertedAt.filter { now - $0.value <= Self.codeCoverMs }
        let taken = batch.filter { codeAlertedAt[$0.threadId] == nil }
        batch = []
        guard let content = NotificationPolicy.alert(for: taken, settings: notifySettings) else { return }
        await post(content)
    }

    private func post(_ content: NotificationContent) async {
        await refreshAuthorization()
        guard authorization == .allowed else { return }
        await center.post(content)
        alertsPosted += 1
        for token in runs.keys { runs[token]?.alerts += 1 }
    }

    // MARK: Run counting (background diagnostics)

    func beginRunCount() -> UUID {
        let token = UUID()
        runs[token] = RunTally()
        return token
    }

    func endRunCount(_ token: UUID) -> (newMail: Int, alerts: Int) {
        let tally = runs.removeValue(forKey: token) ?? RunTally()
        return (tally.threads.count, tally.alerts)
    }

    // MARK: Snooze wake-ups

    private func scheduleDueReconcile() {
        dueTask?.cancel()
        dueTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { return }
            await self?.reconcileDue()
        }
    }

    /// Makes the pending local notifications match the snoozed conversations.
    func reconcileDue() async {
        guard let service else { return }
        await refreshAuthorization()
        guard authorization == .allowed else { return }
        let snoozed = (try? await service.listThreads(ThreadQuery(view: .snoozed, limit: 100)))?.items ?? []
        let desired = DueNotificationPlanner.plan(snoozed: snoozed, settings: notifySettings, nowMs: nowMs())
        let plan = DueNotificationPlanner.diff(desired: desired, pendingIds: await center.pendingIdentifiers())
        if !plan.remove.isEmpty { await center.removePending(plan.remove) }
        for content in plan.add { await center.post(content) }
    }

    // MARK: Badge

    func updateBadge(inboxUnread: Int) async {
        guard await center.authorization() == .allowed else { return }
        await center.setBadge(NotificationPolicy.badgeCount(notifySettings, inboxUnread: inboxUnread))
    }

    // MARK: Responses

    /// Runs what a tap or a button asked for. `.open` and `.openApp` are navigation and belong to the app model, which calls
    /// this for the rest.
    func perform(_ request: NotificationRequest) async {
        switch request {
        case .archive(let threadId):
            _ = try? await service?.archive([threadId])
            await center.removeDelivered(threadId: threadId)
        case .markRead(let threadId):
            _ = try? await service?.markRead([threadId], read: true)
            await center.removeDelivered(threadId: threadId)
        case .copyCode(let code, let codeId):
            await copy(code: code, codeId: codeId)
        case .open, .openApp:
            break
        }
    }

    func copy(code: String, codeId: String?) async {
        clipboard.copy(code)
        if let codeId { await service?.markCodeUsed(id: codeId) }
        onCopied()
    }
}

extension NotificationCoordinator {
    /// `-FlintSystemNotifications YES` keeps the system centre for a demo run. Debug builds only.
    private static func systemNotificationsForced(_ defaults: UserDefaults) -> Bool {
        #if DEBUG
        defaults.bool(forKey: "FlintSystemNotifications")
        #else
        false
        #endif
    }

    /// The coordinator the app uses. The system centre is used for a normal launch. Unit tests, `-FlintFakeNotifications` and
    /// the demo mailbox (unless `-FlintSystemNotifications YES`) get an in-memory one: a demo run never shows a real prompt.
    @MainActor
    static func makeDefault(defaults: UserDefaults = .standard) -> NotificationCoordinator {
        let fake = FlintDebugFlags.fakeNotifications(defaults: defaults)
        let demo = DemoSeed.isRequested(defaults: defaults) && !systemNotificationsForced(defaults)
        let inMemory = fake || demo || FlintDebugFlags.isHostingUnitTests
        let center: any NotificationScheduling = inMemory
            ? MemoryNotificationScheduler(status: fake ? FlintDebugFlags.fakeNotificationStatus(defaults: defaults) : .notDetermined)
            : SystemNotificationScheduler()
        let clipboard: any CodeClipboard = inMemory ? MemoryCodeClipboard() : SystemCodeClipboard()
        return NotificationCoordinator(center: center, clipboard: clipboard, isForeground: { UIApplication.shared.applicationState == .active })
    }
}
