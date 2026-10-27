// What runs while the service is started: the event listeners (verification codes, reply receipts), the one-time
// maintenance (re-categorizing after a categorizer change, durable server operations, interrupted sends) and the scheduler pump.

import FlintClassify
import FlintMail
import FlintModel
import FlintReceipts
import FlintStore
import Foundation
import Synchronization

final class RuntimeState: Sendable {
    private struct State {
        var started = false
        var subscriptions: [EventBus.Subscription] = []
        var maintenance: Task<Void, Never>?
        var knownReceipts: [String: ReceiptStatus] = [:]
        var lastReceiptPoll: EpochMs = 0
    }
    private let state = Mutex(State())

    /// True the first time, so `start()` called again on every foreground only does the cheap part.
    func markStarted() -> Bool { state.withLock { s in defer { s.started = true }; return !s.started } }
    var isStarted: Bool { state.withLock { $0.started } }
    var maintenanceTask: Task<Void, Never>? { state.withLock { $0.maintenance } }

    func take() -> (subscriptions: [EventBus.Subscription], maintenance: Task<Void, Never>?) {
        state.withLock { s in
            defer { s.started = false; s.subscriptions = []; s.maintenance = nil }
            return (s.subscriptions, s.maintenance)
        }
    }

    func set(subscriptions: [EventBus.Subscription]) { state.withLock { $0.subscriptions = subscriptions } }

    /// Wires the listeners unless they already are, so `start()` and `startListeners()` never double them.
    func installSubscriptionsIfNone(_ make: () -> [EventBus.Subscription]) {
        state.withLock { s in if s.subscriptions.isEmpty { s.subscriptions = make() } }
    }
    func set(maintenance: Task<Void, Never>?) { state.withLock { $0.maintenance = maintenance } }

    /// True when `interval` has passed since the last poll; records this one.
    func receiptPollDue(now: EpochMs, interval: Int) -> Bool {
        state.withLock { s in
            guard now - s.lastReceiptPoll >= interval else { return false }
            s.lastReceiptPoll = now
            return true
        }
    }

    func receiptStatus(_ key: String) -> ReceiptStatus? { state.withLock { $0.knownReceipts[key] } }
    func setReceiptStatus(_ key: String, _ status: ReceiptStatus) { state.withLock { $0.knownReceipts[key] = status } }
}

extension ServiceCore {
    static let categorizerVersionKey = "categorizerVersion"
    static let headersVersionKey = "categorizerHeadersVersion"
    /// How far back header refresh reaches: the inbox people actually look at.
    static let headerRefreshDays = 90
    static let receiptPollIntervalMs = 5 * 60 * 1000

    // MARK: Wiring

    func wireListeners() -> [EventBus.Subscription] {
        [
            bus.subscribe { [weak self] event in
                guard let self else { return }
                if case .newMail(_, let threadId, _, _, _, _, _) = event { Task { await self.detectCodes(threadId) } }
            },
            bus.subscribe { [weak self] event in
                guard let self else { return }
                switch event {
                case .receipt(let id, let email, let status, _): self.runtime.setReceiptStatus("\(id)|\(email)", status)
                case .mailChanged(_, let ids) where !ids.isEmpty: Task { await self.watchReplies(ids) }
                default: break
                }
            },
        ]
    }

    /// Looks at a thread's fresh unread messages and announces the codes found.
    private func detectCodes(_ threadId: ThreadID) async {
        guard let settings = try? await store.settings(), settings.codes.enabled else { return }
        for code in await codes.scan(threadId: threadId) { emit(.code(code)) }
    }

    /// Mail sync does not report which tracked recipients replied, so thread changes are watched instead: when a recipient's
    /// status becomes `replied` a `.receipt` event is emitted. Statuses already announced are remembered.
    private func watchReplies(_ threadIds: [ThreadID]) async {
        guard let tracked = try? await store.listTracked(limit: 500, unopenedOnly: nil) else { return }
        for item in tracked where item.threadId.map(threadIds.contains) == true {
            for recipient in item.recipients {
                let key = "\(item.trackedId)|\(recipient.email)"
                let before = runtime.receiptStatus(key)
                runtime.setReceiptStatus(key, recipient.status)
                if recipient.status == .replied, before != .replied {
                    emit(.receipt(trackedId: item.trackedId, email: recipient.email, status: .replied, at: recipient.repliedAt ?? now()))
                }
            }
        }
    }

    // MARK: Maintenance

    /// Everything that should happen once per launch, off the main path.
    func runMaintenance() async {
        _ = try? await store.kvPurgeExpired(now: now())
        _ = await optimistic.replayPending()
        await scheduler.recoverInterruptedSends()
        await recategorizeIfStale()
        if config.autoSync { await refreshHeadersIfStale() }
        if config.autoSync { await pollReceipts() }
        if config.runsScheduler {
            await pump.bind { [weak self] in await self?.pumpTick() }
            await pump.start()
        }
    }

    /// One pass of the foreground pump: due work, then a receipts poll when the last one was a while ago.
    private func pumpTick() async -> EpochMs? {
        let next = await runDueWork()
        if config.autoSync, runtime.receiptPollDue(now: now(), interval: Self.receiptPollIntervalMs) { await pollReceipts() }
        return next
    }

    /// Re-labels existing mail once when the categorizer has changed since the last run. Returns how many messages changed.
    @discardableResult
    func recategorizeIfStale() async -> Int {
        let stored = (try? await store.kvGet(Self.categorizerVersionKey, now: now())).flatMap(Int.init)
        guard RecategorizePlan.isStale(storedVersion: stored) else { return 0 }
        guard let changed = try? await store.recategorizeAll() else { return 0 }
        try? await store.kvSet(Self.categorizerVersionKey, String(categorizerVersion), ttlMs: nil, now: now())
        if changed > 0 { await announceAllAccounts() }
        return changed
    }

    /// Once per categorizer version: re-fetch the categorization headers of recent mail (older syncs stored fewer), then re-label.
    @discardableResult
    func refreshHeadersIfStale() async -> Int {
        let stored = (try? await store.kvGet(Self.headersVersionKey, now: now())).flatMap(Int.init)
        guard RecategorizePlan.isStale(storedVersion: stored) else { return 0 }
        let since = now() - Self.headerRefreshDays * 24 * 60 * 60 * 1000
        var failed = false
        for account in ((try? await store.listAccounts()) ?? []) where account.enabled {
            guard let targets = try? await store.headerRefreshTargets(accountId: account.id, sinceMs: since), !targets.isEmpty else { continue }
            do { _ = try await sync.session(for: account.id).refreshHeaders(targets) } catch { failed = true }
        }
        let changed = (try? await store.recategorizeAll()) ?? 0
        if !failed { try? await store.kvSet(Self.headersVersionKey, String(categorizerVersion), ttlMs: nil, now: now()) }
        if changed > 0 { await announceAllAccounts() }
        return changed
    }

    func pollReceipts() async {
        guard await receipts.isConfigured() else { return }
        _ = runtime.receiptPollDue(now: now(), interval: 0)
        _ = try? await receipts.pollEvents()
    }

    /// Runs everything that is due now (sends past their undo window, snoozes, reminders). Returns when the next item is due.
    /// The foreground pump calls this; a background task calls it for the same purpose.
    func runDueWork() async -> EpochMs? { await scheduler.tick() }
}
