// The wiring: every engine module built once and connected. `FlintService` is the public face; this is what it calls.
// Nothing here starts work. `FlintService.start()` does that, so tests and previews can build the graph without a network.

import FlintClassify
import FlintHTML
import FlintMail
import FlintModel
import FlintReceipts
import FlintStore
import Foundation

final class ServiceCore: Sendable {
    let config: FlintServiceConfiguration
    let store: any Store
    let bus = EventBus()
    let hooks = ServiceHooks()
    let sync: SyncManager
    let auth: AuthStack
    let undo: UndoRegistry
    let optimistic: OptimisticActions
    let threadActions: ThreadActions
    let receipts: ReceiptsClient
    let serverDrafts: ServerDrafts
    let sendQueue: SendQueue
    let sendJob: SendJob
    let scheduler: MailScheduler
    let pump: SchedulerPump
    let codes: CodesRegistry
    let categoryUndo = CategoryUndo()
    let firstOpen = FirstOpenSet()
    let runtime = RuntimeState()

    var emit: @Sendable (FlintEvent) -> Void { { [bus] in bus.emit($0) } }
    func now() -> EpochMs { config.clock() }

    init(store: any Store, config: FlintServiceConfiguration) {
        self.config = config
        self.store = store
        let bus = self.bus
        let emit: @Sendable (FlintEvent) -> Void = { bus.emit($0) }
        let now = config.clock
        let hooks = self.hooks

        let auth = AuthStack(
            store: store, secrets: config.secrets, http: config.http, autoconfig: config.autoconfig, transport: config.transport,
            browser: config.browser, lifecycle: hooks, failures: hooks, now: now)
        var sessionConfig = SessionConfiguration(cacheRoot: config.cacheDirectory)
        config.session.apply(to: &sessionConfig)
        let sync = SyncManager(SyncManager.Dependencies(
            store: store, transport: config.transport, credentials: { try await auth.credential(for: $0) }, emit: emit,
            configuration: sessionConfig, network: config.network, now: now, runs: config.autoSync))
        hooks.bind(sync: sync, emit: emit, cacheDirectory: config.cacheDirectory)

        let undo = UndoRegistry(now: now)
        let optimistic = OptimisticActions(store: store, emit: emit, undo: undo, actionsFor: { sync.session(for: $0).serverActions }, now: now)
        let receipts = ReceiptsClient(
            store: store, secrets: config.secrets, receiptsSettings: { (try? await store.settings().receipts) ?? Settings.default.receipts },
            transport: config.receiptsTransport, now: now, emit: emit)
        let serverDrafts = ServerDrafts(store: store, runner: { sync.session(for: $0) }, emit: emit)
        let pump = SchedulerPump(now: now)
        let draftsDirectory = config.draftsDirectory

        let sendJob = SendJob(SendJob.Dependencies(
            store: store, tracking: ReceiptsTracking(client: receipts),
            mailer: { account in
                let session = sync.session(for: account.id)
                return Mailer(smtp: { try await session.send($0) }, sentCopy: SentCopy(runner: session))
            },
            actions: { sync.session(for: $0).serverActions },
            syncSoon: { id in Task { await sync.session(for: id).nudge() } },
            emit: emit, now: now))
        let hooksForScheduler = MailScheduler.Hooks(
            sendDraft: { draftId, scheduledId in try await sendJob.run(draftId: draftId, scheduledId: scheduledId) },
            didSend: { sent in
                await DraftCleanup.afterSend(sent, store: store, serverDrafts: serverDrafts, draftsDirectory: draftsDirectory, emit: emit)
            },
            didReminder: { outcome in emit(.toast(.info, message: outcome.message, undoToken: nil)) })
        let scheduler = MailScheduler(store: store, actions: { sync.session(for: $0).serverActions }, hooks: hooksForScheduler, emit: emit, now: now)

        self.sync = sync
        self.auth = auth
        self.undo = undo
        self.optimistic = optimistic
        self.threadActions = ThreadActions(store: store, pipeline: optimistic)
        self.receipts = receipts
        self.serverDrafts = serverDrafts
        self.sendQueue = SendQueue(store: store, emit: emit, poke: { pump.poke() }, now: now)
        self.sendJob = sendJob
        self.scheduler = scheduler
        self.pump = pump
        self.codes = CodesRegistry(store: store, now: now)
    }
}
