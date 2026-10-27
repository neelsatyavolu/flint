import FlintMail
import FlintModel
import FlintService
import Foundation
import Observation
import SwiftUI

/// The composition root. It opens `FlintService` (the real database, the demo seed, or a service a test built), keeps the state
/// every screen reads (accounts, sidebar, sync, settings, codes) fresh from the service's streams, owns navigation and hosts
/// the toast and undo centre. Screens read its properties, call its async methods and never touch the engine directly.
/// Reading and action methods live in the `AppModel+...` files; `docs/ios/WAVE3-CONTRACT.md` lists them.
@MainActor @Observable
final class AppModel {
    enum Phase: Equatable {
        case launching
        case ready
        case failed(String)
    }

    // MARK: Boot
    private(set) var phase: Phase = .launching
    let mode: LaunchMode
    let toasts: ToastCenter

    // MARK: State refreshed from the service
    private(set) var accounts: [Account] = []
    private(set) var sidebar: SidebarData?
    private(set) var syncStatuses: [SyncStatus] = []
    private(set) var settings: Settings?
    private(set) var codes: [VerificationCode] = []

    // MARK: Navigation
    var mailbox: MailboxSelection = .unifiedInbox
    var openThread: ThreadID? {
        didSet { if oldValue != nil, openThread == nil { returnToSearchIfNeeded() } }
    }
    var presented: Presented?
    /// iPad: the composer panel stays on screen while a thread, search or settings opens. It is held here while another
    /// sheet is `presented`; `composerPanelRequest` is what the panel shows.
    internal(set) var parkedCompose: ComposeRequest?
    /// True when the window is wide enough for the composer panel (set by the root view from the size class).
    internal(set) var isWide = false
    /// The Face ID lock cover is up: no shortcut may act on mail that is not on screen (set by the app from `AppLock`).
    var isCovered = false
    /// The open conversation's own Snooze or Move sheet is up (set by the thread toolbar).
    var threadSheetUp = false
    /// The conversations the list on screen shows, in order, for J and K (published by the inbox).
    var visibleThreadIds: [ThreadID] = []
    /// The query of the search a thread was opened from, so Back returns to the results.
    internal(set) var searchReturn: String?
    var columnVisibility: NavigationSplitViewVisibility = .all
    /// The last link the app was opened with, until the owning feature takes it with `takePendingLink()`.
    private(set) var pendingLink: DeepLink?

    // MARK: Search
    var recentSearches: [String] = []

    @ObservationIgnored private(set) var service: FlintService?
    @ObservationIgnored let defaults: UserDefaults
    @ObservationIgnored private var observers: [Task<Void, Never>] = []
    @ObservationIgnored private var demoDirectory: URL?
    @ObservationIgnored let backgroundTasking: any BackgroundTasking
    /// Local notifications behind send later, follow-up reminders and snooze (Features/Scheduling).
    @ObservationIgnored let scheduling: SchedulingCoordinator
    @ObservationIgnored var backgroundEpoch = 0
    /// How many times a background cycle stopped the service (read by tests).
    @ObservationIgnored var backgroundStops = 0
    @ObservationIgnored var drainTask: Task<SendDrain.Outcome, Never>?
    // Notifications and background runs (Background.swift, Features/Notifications).
    @ObservationIgnored let notifications: NotificationCoordinator
    @ObservationIgnored let backgroundScheduler: any BackgroundTaskScheduling
    @ObservationIgnored let diagnosticsStore: BackgroundDiagnosticsStore
    @ObservationIgnored var notificationResponder: NotificationResponder?
    /// Demo only: delivers one more message before a background run syncs.
    @ObservationIgnored var demoDeliverNewMail: (@Sendable () async -> Void)?
    @ObservationIgnored private var bootstrapTask: Task<Void, Never>?
    internal(set) var diagnostics = BackgroundDiagnostics()

    init(mode: LaunchMode = .fromArguments(), toasts: ToastCenter = ToastCenter(), defaults: UserDefaults = .standard, backgroundTasking: any BackgroundTasking = SystemBackgroundTasking(), notifier: (any LocalNotificationScheduling)? = nil, notifications: NotificationCoordinator? = nil, backgroundScheduler: (any BackgroundTaskScheduling)? = nil) {
        // swift-log is process-wide and SwiftMail logs hosts and commands: install the privacy handler before any transport exists.
        FlintLogging.bootstrap()
        self.mode = mode
        self.toasts = toasts
        self.defaults = defaults
        self.backgroundTasking = backgroundTasking
        if case .live = mode { scheduling = SchedulingCoordinator(notifier: notifier ?? UserNotificationScheduler()) } else {
            scheduling = SchedulingCoordinator(notifier: notifier ?? NoNotifications())
        }
        self.notifications = notifications ?? NotificationCoordinator.makeDefault()
        self.backgroundScheduler = backgroundScheduler ?? (FlintDebugFlags.isHostingUnitTests ? RecordingBackgroundTaskScheduling() : SystemBackgroundTaskScheduling())
        self.diagnosticsStore = BackgroundDiagnosticsStore(defaults: defaults)
        self.diagnostics = diagnosticsStore.load()
        self.notifications.onCopied = { [toasts] in toasts.show(String(localized: "Code copied", table: "Shell")) }
        recentSearches = mode.isDemo ? [] : defaults.stringArray(forKey: Self.recentsKey) ?? []
    }

    var isDemo: Bool { mode.isDemo }

    // MARK: Lifecycle

    /// Opens the service and loads the first state. Safe to call more than once; only the first call does anything.
    func bootstrap() async {
        // Two callers can arrive together (the window and a notification action); both wait for the same run.
        if let bootstrapTask { return await bootstrapTask.value }
        let task = Task { await performBootstrap() }
        bootstrapTask = task
        await task.value
    }

    private func performBootstrap() async {
        guard phase == .launching else { return }
        do {
            let service = try await openService()
            self.service = service
            try await loadInitialState(from: service)
            startObserving(service)
            await service.start()
            phase = .ready
            if accounts.isEmpty && !isDemo { presented = .onboarding }
        } catch {
            phase = .failed(FlintErrorText.message(for: error))
        }
    }

    private func openService() async throws -> FlintService {
        switch mode {
        case .injected(let service):
            return service
        case .demo:
            let seeded = try await DemoSeed.make()
            demoDirectory = seeded.directory
            demoDeliverNewMail = seeded.deliverNewMail
            return seeded.service
        case .live:
            return try await FlintService.open(configuration: LiveConfiguration.make())
        }
    }

    /// Foreground: start sync again and send whatever came due while the app was away. Cheap when already running.
    func sceneBecameActive() async {
        cancelBackgroundDrain()
        await service?.start()
        await service?.runDueWork()
        if let service { await ReceiptsPoller.shared.pollIfDue(ServiceReceiptsSource(service: service)) }
    }

    /// Stops observing and, for a demo launch, deletes the temporary database.
    func shutdown() async {
        for task in observers { task.cancel() }
        observers = []
        await service?.stop()
        if let demoDirectory { try? FileManager.default.removeItem(at: demoDirectory) }
    }

    // MARK: Observation

    private func loadInitialState(from service: FlintService) async throws {
        accounts = try await service.listAccounts()
        settings = try await service.currentSettings()
        if let settings { notifications.update(settings: settings) }
        syncStatuses = try await service.syncStatuses()
        sidebar = try await Self.firstValue(of: service.sidebar())
    }

    private func startObserving(_ service: FlintService) {
        notifications.attach(service: service)
        observe(service.sidebar()) { model, sidebar in
            model.sidebar = sidebar
            Task { await model.notifications.updateBadge(inboxUnread: sidebar.counts.inbox) }
        }
        observe(service.accounts()) { $0.accounts = $1 }
        observe(service.syncStatus()) { $0.syncStatuses = $1 }
        observe(service.settings()) { model, settings in
            model.settings = settings
            model.notifications.update(settings: settings)
        }
        observe(service.codes()) { $0.codes = $1 }
        observe(service.scheduled()) { model, waiting in Task { await model.scheduling.reconcile(waiting: waiting) } }
        let events = service.events()
        observers.append(Task { [weak self] in
            for await event in events {
                guard let self else { return }
                self.handle(event)
            }
        })
    }

    private func observe<Value: Sendable>(_ stream: AsyncThrowingStream<Value, Error>, apply: @escaping @MainActor (AppModel, Value) -> Void) {
        observers.append(Task { [weak self] in
            do {
                for try await value in stream {
                    guard let self else { return }
                    apply(self, value)
                }
            } catch {
                self?.report(error)
            }
        })
    }

    private static func firstValue<Value: Sendable>(of stream: AsyncThrowingStream<Value, Error>) async throws -> Value {
        for try await value in stream { return value }
        throw FlintError(.internal, "The service stopped before it answered.")
    }

    /// Service toasts (a failed send, a fired reminder) go to the toast centre. Other events reach features through `events()`.
    private func handle(_ event: FlintEvent) {
        scheduling.observe(event, ownAddresses: Set(accounts.flatMap { [$0.email] + $0.aliases }.map { $0.lowercased() }))
        notifications.ingest(event)
        guard case .toast(let level, let message, let token) = event else { return }
        var undo: (@MainActor () async -> Void)?
        if let token { undo = { [weak self] in await self?.undo(token: token) } }
        toasts.show(message, kind: level == .error ? .error : .info, undo: undo)
    }

    /// Every service event from now on, for features that react to them (new mail, sends, receipts).
    func events() -> AsyncStream<FlintEvent> { service?.events() ?? AsyncStream { $0.finish() } }

    // MARK: Errors

    /// The service, or `.internal` before `bootstrap()` finished. Features use it for anything AppModel does not wrap.
    func requireService() throws -> FlintService {
        guard let service else { throw FlintError(.internal, "Flint is still starting.") }
        return service
    }

    /// Shows an error as a toast unless it is silent (the person closed the Google sheet).
    func report(_ error: any Error) {
        guard !FlintErrorText.isSilent(error) else { return }
        toasts.show(FlintErrorText.message(for: error), kind: .error)
    }

    func takePendingLink() -> DeepLink? {
        defer { pendingLink = nil }
        return pendingLink
    }

    func setPendingLink(_ link: DeepLink?) { pendingLink = link }

    static let recentsKey = "flint.recentSearches"
}
