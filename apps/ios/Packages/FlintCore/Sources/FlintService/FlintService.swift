// The API the UI calls. One `FlintService` per app process: it owns the store, one sync session per account, the optimistic
// action pipeline, the send queue and scheduler, receipts, verification codes and the event bus. UI code never touches the
// engine modules directly; it calls this, iterates the observable streams and listens to `events()`.
//
// Shape of the surface (mirrors the desktop `FlintApi`, plus streams):
//   lifecycle   open / start / stop / runDueWork / syncNow
//   streams     threads, thread, sidebar, folders, accounts, syncStatus, settings, drafts, scheduled, tracked
//   reading     listThreads, loadOlder, searchServer, thread, message, allowRemoteImages, attachment, contacts
//   actions     markRead, setPinned, archive, trash, markSpam, move, snooze, mute, setCategory, undo, unsubscribe, block
//   compose     createDraft ... sendDraft, cancelSend, scheduled sends, signatures, templates, rules
//   accounts    autoconfig, testConnection, addAccount, addGoogleAccount, update, remove
//   other       settings, receipts, verification codes
// Errors are always `FlintError`.

import FlintMail
import FlintModel
import FlintStore
import Foundation

public final class FlintService: Sendable {
    let core: ServiceCore

    /// Builds the service around an already open store (tests and previews). Nothing runs until `start()`.
    public init(store: any Store, configuration: FlintServiceConfiguration) {
        core = ServiceCore(store: store, config: configuration)
    }

    /// Opens (or creates) the database under `configuration.dataDirectory` and builds the service. The database holds mail,
    /// so the file is protected until the first unlock after boot: background refresh can still use it while the phone is locked.
    public static func open(configuration: FlintServiceConfiguration) async throws -> FlintService {
        try FileProtection.prepare(directory: configuration.dataDirectory)
        let store = try GRDBStore.open(path: configuration.databasePath, classifier: ClassifierAdapter(), clock: configuration.clock)
        FileProtection.apply(toDatabaseAt: configuration.databasePath)
        return FlintService(store: store, configuration: configuration)
    }

    // MARK: Lifecycle

    /// Starts everything for the foreground: sync sessions, the scheduler pump, the event listeners, and (first time) one-time
    /// maintenance. Calling it again on every foreground is cheap. Returns once the first start-up steps have been queued.
    public func start() async {
        if core.runtime.markStarted() {
            core.runtime.installSubscriptionsIfNone { core.wireListeners() }
            core.runtime.set(maintenance: Task { [core] in await core.runMaintenance() })
        }
        await core.sync.startAll()
    }

    /// Only the event listeners (verification codes, reply watching), for a background run that syncs by hand. A process that was
    /// stopped on the way to the background and then woken for a refresh has none; this brings them back without the IDLE
    /// sessions, the pump or the one-time maintenance. Safe to call again, and before or after `start()`.
    public func startListeners() {
        core.runtime.installSubscriptionsIfNone { core.wireListeners() }
    }

    /// Stops sync and the pump (the app is going to the background). `start()` resumes.
    public func stop() async {
        let taken = core.runtime.take()
        for subscription in taken.subscriptions { subscription() }
        taken.maintenance?.cancel()
        await core.pump.stop()
        await core.sync.stopAll()
    }

    /// Code detection in progress and codes announced. New mail starts a scan a moment after the sync reports it; a background run
    /// reads this to know when the `.code` events for its mail have all been emitted.
    public var codeDetection: CodeDetectionState { core.runtime.codeDetection }

    /// Waits for the start-up maintenance (re-categorizing, replaying interrupted server operations). For tests and diagnostics.
    public func waitForMaintenance() async { await core.runtime.maintenanceTask?.value }

    /// Runs everything due now: sends past their undo window, snoozes that end, reminders. Returns when the next one is due so a
    /// background task or local notification can be armed for that time.
    @discardableResult
    public func runDueWork() async -> EpochMs? { await core.runDueWork() }

    /// Syncs one account, or every enabled account, and returns when the cycle finishes.
    public func syncNow(accountId: AccountID? = nil) async throws {
        let accounts = try await core.store.listAccounts().filter { $0.enabled && (accountId == nil || $0.id == accountId) }
        if let accountId, accounts.isEmpty { throw FlintError(.notFound, "No such account: \(accountId).") }
        // Each account has its own session and connections, so they sync side by side: a refresh takes as long as the slowest
        // account, not the sum of all of them.
        let sync = core.sync
        let firstError = await withTaskGroup(of: Error?.self) { group -> Error? in
            for account in accounts {
                group.addTask {
                    do { try await sync.session(for: account.id).syncNow() } catch { return error }
                    return nil
                }
            }
            var first: Error?
            for await error in group { first = first ?? error }
            return first
        }
        if let firstError, accounts.count == 1 { throw firstError }
    }

    /// A push or foreground hint: sync soon, without waiting.
    public func nudge(accountId: AccountID? = nil) async {
        for session in core.sync.runningSessions() {
            let id = await session.accountId
            if accountId == nil || id == accountId { await session.nudge() }
        }
    }

    // MARK: Events

    /// Every event from now on, in order. Iterate in a task; cancelling the task unsubscribes.
    public func events() -> AsyncStream<FlintEvent> { core.bus.stream() }

    /// The callback form, for code that is not async. Keep the listener quick.
    public func subscribe(_ listener: @escaping @Sendable (FlintEvent) -> Void) -> EventBus.Subscription { core.bus.subscribe(listener) }

    /// For code that needs to emit into the same bus (background tasks, notification actions).
    public func emit(_ event: FlintEvent) { core.bus.emit(event) }

    // MARK: Current state

    public func syncStatuses() async throws -> [SyncStatus] {
        core.sync.statuses(for: try await core.store.listAccounts())
    }
}
