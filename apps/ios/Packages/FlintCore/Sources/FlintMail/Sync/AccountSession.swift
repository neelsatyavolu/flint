// Keeps one account's local store in step with its IMAP server: initial and incremental sync, IDLE, reconnect with
// backoff, on-demand bodies and attachments. Also the account's `TransportRunner`, so server actions share its command
// connection. One session owns two transports (commands and IDLE) and tears both down when stopped.
// Port of packages/core/src/mail/sync/accountSync.ts.

import FlintModel
import FlintStore
import Foundation

public struct SessionConfiguration: Sendable {
    /// Poll interval when IDLE is not available.
    public var pollInterval: Duration = .seconds(120)
    /// Poll interval as a safety net while IDLE is active.
    public var idlePollInterval: Duration = .seconds(600)
    public var backoffMinimum: Duration = .seconds(5)
    public var backoffMaximum: Duration = .seconds(300)
    /// Consecutive rejected sign-ins tolerated before the account is marked as needing a new sign-in.
    public var authRetries = 2
    /// Messages whose bodies are prefetched per mailbox lock.
    public var prefetchChunk = 5
    /// Every Nth cycle looks for expunged mail even when the message count did not change.
    public var reconcileEveryCycles = 15
    /// An IDLE connection that ends sooner than this is not restarted at once.
    public var idleMinimumLifetime: Duration = .seconds(10)
    /// Root of the attachment cache (`<root>/attachments/...`).
    public var cacheRoot: URL

    public init(cacheRoot: URL) { self.cacheRoot = cacheRoot }
}

public actor AccountSession: TransportRunner {
    /// Called whenever a transport needs credentials. The auth layer (track 2C) refreshes OAuth tokens here.
    public typealias CredentialProvider = @Sendable () async throws -> MailCredential

    public let accountId: AccountID
    private let store: any MailEngineStore
    private let factory: MailTransportFactory
    private let credentials: CredentialProvider
    private let emit: @Sendable (FlintEvent) -> Void
    private let now: @Sendable () -> EpochMs
    private let config: SessionConfiguration
    private let network: (any NetworkMonitoring)?

    private let commandLock = AsyncLock()
    private let cycleLock = AsyncLock()

    private var commandTransport: (any MailTransport)?
    private var idleTransport: (any MailTransport)?
    private var idleTask: Task<Void, Never>?
    private var idleGeneration = 0
    private var idleNotBefore: ContinuousClock.Instant?
    private var loopTask: Task<Void, Never>?
    private var networkTask: Task<Void, Never>?
    private var lastPath: NetworkPathState?
    private var stopped = true

    private var wakeWaiter: CheckedContinuation<Void, Never>?
    private var pendingWake = false
    private var waitGeneration = 0

    private var statusValue: SyncStatus
    private var lastExists: [FolderID: Int] = [:]
    private var cycles = 0

    public init(
        accountId: AccountID, store: any MailEngineStore, transportFactory: @escaping MailTransportFactory, credentials: @escaping CredentialProvider,
        emit: @escaping @Sendable (FlintEvent) -> Void, configuration: SessionConfiguration, network: (any NetworkMonitoring)? = nil,
        now: @escaping @Sendable () -> EpochMs = { Int(Date().timeIntervalSince1970 * 1000) }
    ) {
        self.accountId = accountId
        self.store = store
        self.factory = transportFactory
        self.credentials = credentials
        self.emit = emit
        self.config = configuration
        self.network = network
        self.now = now
        self.statusValue = SyncStatus(accountId: accountId, state: .idle)
    }

    public var status: SyncStatus { statusValue }

    /// Server actions that run on this session's command connection.
    public nonisolated var serverActions: ServerActions { ServerActions(store: store, accountId: accountId, runner: self) }

    // MARK: Lifecycle

    /// Starts the sync loop. Returns at once; progress arrives as sync events.
    public func start() {
        guard stopped else { return }
        stopped = false
        pendingWake = false
        loopTask = Task { [weak self] in await self?.runLoop() }
        if let network {
            networkTask = Task { [weak self] in
                var first = true
                for await state in network.updates() {
                    await self?.pathChanged(state, initial: first)
                    first = false
                }
            }
        }
    }

    /// Stops the loop and disconnects both transports. Safe to call again; `start` resumes.
    public func stop() async {
        stopped = true
        wake()
        networkTask?.cancel()
        networkTask = nil
        await closeTransports()
        await loopTask?.value
        loopTask = nil
    }

    /// Runs one full sync cycle now and returns when it finishes. Throws the sync error.
    public func syncNow() async throws {
        try await cycleLock.withLock { try await self.syncCycle() }
    }

    /// Wakes the loop so it syncs soon (a push hint, a foreground event).
    public func nudge() { wake() }

    // MARK: Runner

    public func run<T: Sendable>(_ body: @Sendable (any MailTransport) async throws -> T) async throws -> T {
        await commandLock.acquire()
        do {
            let transport = try await ensureCommandTransport()
            let value = try await body(transport)
            await commandLock.release()
            return value
        } catch {
            if (error as? FlintError)?.code == .network { await dropCommandTransport() }
            await commandLock.release()
            throw error
        }
    }

    /// Hands one message to SMTP. The transport opens its own SMTP connection for it, so the IMAP connection only stays busy
    /// for the hand-off. Pass this (as a closure) to `Mailer`.
    public func send(_ message: OutgoingMessage) async throws {
        try await run { t in try await t.send(message) }
    }

    // MARK: On-demand operations

    /// Syncs one folder on demand, such as a user folder opened for the first time.
    public func syncFolderNow(_ folderId: FolderID) async throws {
        guard let folder = try await store.folder(id: folderId) else { throw FlintError(.notFound, "That folder no longer exists.") }
        let gmail = try await isGmailMode()
        let collector = SyncCollector()
        try await syncOne(folder, gmail: gmail, collector: collector)
        let drained = await collector.drain()
        emitChanged(drained.changed)
        await afterBatches(drained.batches, gmail: gmail)
    }

    /// Fetches the next batch of older mail for these folders. Reports how many messages arrived and whether older mail remains.
    public func loadOlder(_ folderIds: [FolderID], batch: Int = FolderSync.backfillBatch) async throws -> FolderSync.BackfillResult {
        let gmail = try await isGmailMode()
        var total = FolderSync.BackfillResult(loaded: 0, hasMore: false)
        var pending: [SyncBatch] = []
        for id in folderIds {
            guard let folder = try await store.folder(id: id) else { continue }
            let collector = SyncCollector()
            let environment = try await makeEnvironment(gmail: gmail, collector: collector)
            let result = try await run { t in try await FolderSync.backfill(environment.context(t), folder: folder, batch: batch) }
            total.loaded += result.loaded
            total.hasMore = total.hasMore || result.hasMore
            let drained = await collector.drain()
            pending += drained.batches
            emitChanged(drained.changed)
        }
        await afterBatches(pending, gmail: gmail)
        return total
    }

    /// Runs server-side searches and ingests matches that are not local yet. The caller turns a parsed query into the plan:
    /// Gmail gets one `.gmailRaw` search in All Mail (or Trash/Spam), other servers one search per folder the query points at.
    public func searchServer(_ plan: [ServerSearch]) async throws -> (found: Int, added: Int) {
        let gmail = try await isGmailMode()
        var total = (found: 0, added: 0)
        var pending: [SyncBatch] = []
        for step in plan {
            guard let folder = try await store.folder(id: step.folderId) else { continue }
            let collector = SyncCollector()
            let environment = try await makeEnvironment(gmail: gmail, collector: collector)
            let criteria = step.criteria
            let result = try await run { t in try await FolderSync.search(environment.context(t), folder: folder, criteria: criteria) }
            total.found += result.found
            total.added += result.added
            let drained = await collector.drain()
            pending += drained.batches
            emitChanged(drained.changed)
        }
        await afterBatches(pending, gmail: gmail)
        return total
    }

    /// Re-fetches the categorization headers for stored messages and merges them in, so a newer categorizer sees the same
    /// signals new mail has. Returns messages updated.
    public func refreshHeaders(_ targets: [HeaderRefreshTarget]) async throws -> Int {
        var updated = 0
        for target in targets {
            for part in chunked(target.uids, size: 200) {
                let options = EnvelopeFetchOptions(bodyStructure: false, headers: MailHeaders.fetchHeaders, gmail: false)
                let envelopes = try await run { t in
                    try await t.withMailbox(target.folderPath, readOnly: true) { try await t.fetchEnvelopes(.uids(part), options: options) }
                }
                let items = envelopes.map { env -> (uid: Int, headers: [String: String]) in
                    var headers = env.headers
                    headers["references"] = nil
                    return (env.uid, headers)
                }
                updated += try await store.mergeHeaders(target.folderId, items)
            }
        }
        return updated
    }

    /// Downloads and stores the text and html of a message. No-op when the body is already stored.
    public func fetchBody(_ messageRowId: MessageRowID) async throws {
        guard let message = try await store.message(id: messageRowId) else { throw FlintError(.notFound, "That message no longer exists.") }
        if message.bodyLoaded { return }
        guard let loc = try await store.messageLocations([messageRowId]).first else { throw FlintError(.notFound, "That message no longer exists.") }
        let body = try await run { t in
            try await t.withMailbox(loc.folderPath, readOnly: true) { try await BodyLoader.load(t, uid: loc.uid) }
        }
        guard let body else { throw FlintError(.notFound, "That message is no longer on the server.") }
        try await store.setBody(messageRowId, body)
        emitChanged([loc.threadId])
    }

    /// The attachment's bytes. Downloaded once, then served from the cache directory.
    public func fetchAttachment(_ attachmentId: Int) async throws -> Data {
        guard let attachment = try await store.attachment(id: attachmentId) else { throw FlintError(.notFound, "That attachment no longer exists.") }
        if let cached = AttachmentCache.read(attachment.cachedPath) { return cached }
        guard let loc = try await store.messageLocations([attachment.messageRowId]).first else { throw FlintError(.notFound, "That message no longer exists.") }
        let part = attachment.part
        let data = try await run { t in
            try await t.withMailbox(loc.folderPath, readOnly: true) { try await t.fetchPart(uid: loc.uid, part: part) }
        }
        let url = AttachmentCache.path(root: config.cacheRoot, accountId: loc.accountId, messageRowId: attachment.messageRowId, attachmentId: attachmentId, filename: attachment.info.filename)
        try AttachmentCache.write(data, to: url)
        try await store.setAttachmentCachedPath(attachmentId, url.path)
        return data
    }

    // Small reads for extensions in other files (actor state is private).
    func folderList() async throws -> [Folder] { try await store.listFolders(accountId: accountId) }
    func folderIsSynced(_ id: FolderID) async throws -> Bool { try await store.folderSyncState(id).uidNext != nil }
    func gmailMode() async throws -> Bool { try await isGmailMode() }

    // MARK: Status and events

    private func setStatus(_ state: SyncState, error: String? = nil, progress: SyncProgress? = nil, lastSyncAt: EpochMs? = nil) {
        var next = statusValue
        next.state = state
        next.error = error
        next.progress = progress
        if let lastSyncAt { next.lastSyncAt = lastSyncAt }
        statusValue = next
        emit(.sync(next))
    }

    private func reportProgress(_ progress: SyncProgress) {
        guard statusValue.state == .syncing else { return }
        setStatus(.syncing, progress: progress, lastSyncAt: nil)
    }

    private func emitChanged(_ threadIds: [ThreadID]) {
        var seen = Set<ThreadID>()
        let unique = threadIds.filter { seen.insert($0).inserted }
        if !unique.isEmpty { emit(.mailChanged(accountId: accountId, threadIds: unique)) }
    }

    // MARK: Loop

    private func wake() {
        if let waiter = wakeWaiter {
            wakeWaiter = nil
            waiter.resume()
        } else {
            pendingWake = true
        }
    }

    private func sleepUntilWake(_ interval: Duration) async {
        if pendingWake || stopped {
            pendingWake = false
            return
        }
        waitGeneration += 1
        let generation = waitGeneration
        let timer = Task { [weak self] in
            try? await Task.sleep(for: interval)
            await self?.timerFired(generation)
        }
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in wakeWaiter = continuation }
        timer.cancel()
    }

    private func timerFired(_ generation: Int) {
        guard generation == waitGeneration, let waiter = wakeWaiter else { return }
        wakeWaiter = nil
        waiter.resume()
    }

    private func runLoop() async {
        var backoff = Backoff(minimum: config.backoffMinimum, maximum: config.backoffMaximum)
        var authFailures = 0
        while !stopped {
            do {
                try await syncNow()
                backoff.reset()
                authFailures = 0
                await startIdle()
                await sleepUntilWake(idleTransport != nil ? config.idlePollInterval : config.pollInterval)
            } catch {
                if stopped { break }
                await closeTransports()
                let flint = error as? FlintError
                // A rejected login may be a transient refusal (Gmail connection limits, a Google 5xx), so retry a couple of
                // times with backoff before telling the user to sign in again.
                if flint?.code == .auth {
                    authFailures += 1
                    if authFailures <= config.authRetries {
                        setStatus(.error, error: flint?.message)
                        await sleepUntilWake(backoff.next())
                        continue
                    }
                    setStatus(.authError, error: "Sign in again.")
                    stopped = true
                    return
                }
                let offline = flint?.code == .network
                setStatus(offline ? .offline : .error, error: flint?.message ?? "Sync failed.")
                await sleepUntilWake(backoff.next())
            }
        }
    }

    private func pathChanged(_ state: NetworkPathState, initial: Bool) async {
        let previous = lastPath
        lastPath = state
        guard !initial, previous != state else { return }
        if !state.satisfied {
            setStatus(.offline, error: nil)
            return
        }
        // NIO sockets do not follow a Wi-Fi to cellular handoff: drop them and reconnect.
        await closeTransports()
        wake()
    }

    // MARK: Connections

    private func connectedTransport() async throws -> any MailTransport {
        let transport = factory()
        guard let account = try await store.account(id: accountId) else { throw FlintError(.notFound, "That account no longer exists.") }
        let credential = try await credentials()
        try await transport.connect(MailTransportConfiguration(server: account.server, credential: credential))
        await adoptGmailProvider(account, transport)
        return transport
    }

    /// A server that advertises X-GM-EXT-1 is Gmail (Workspace, a custom domain, an account added as Other email). Marks the
    /// account so label-aware sync is used. Only before any mail is stored: switching later would re-ingest everything.
    private func adoptGmailProvider(_ account: Account, _ transport: any MailTransport) async {
        guard account.provider != .gmail, await transport.capabilities.gmail else { return }
        guard (try? await store.accountHasMessages(accountId)) == false else { return }
        _ = try? await store.updateAccount(accountId, AccountPatch(provider: .gmail))
    }

    private func ensureCommandTransport() async throws -> any MailTransport {
        if let existing = commandTransport {
            if await existing.isConnected { return existing }
            await existing.disconnect()
            commandTransport = nil
        }
        let transport = try await connectedTransport()
        commandTransport = transport
        return transport
    }

    private func dropCommandTransport() async {
        let old = commandTransport
        commandTransport = nil
        await old?.disconnect()
    }

    private func closeTransports() async {
        idleGeneration += 1
        idleTask?.cancel()
        idleTask = nil
        let idle = idleTransport
        let command = commandTransport
        idleTransport = nil
        commandTransport = nil
        await idle?.disconnect()
        await command?.disconnect()
    }

    // MARK: IDLE

    private func startIdle() async {
        if idleTransport != nil { return }
        if let notBefore = idleNotBefore, ContinuousClock.now < notBefore { return }
        let transport: any MailTransport
        do { transport = try await connectedTransport() } catch { return }
        guard await transport.capabilities.idle else {
            await transport.disconnect()
            return
        }
        let inbox = (try? await store.folder(accountId: accountId, role: .inbox))?.path ?? "INBOX"
        let stream = await transport.idle(mailbox: inbox)
        idleGeneration += 1
        let generation = idleGeneration
        let started = ContinuousClock.now
        idleTransport = transport
        idleTask = Task { [weak self] in
            for await event in stream {
                if case .disconnected = event { break }
                await self?.wake()
            }
            await self?.idleEnded(generation: generation, startedAt: started, transport: transport)
        }
    }

    private func idleEnded(generation: Int, startedAt: ContinuousClock.Instant, transport: any MailTransport) async {
        await transport.disconnect()
        guard generation == idleGeneration else { return }
        idleTransport = nil
        idleTask = nil
        if ContinuousClock.now - startedAt < config.idleMinimumLifetime { idleNotBefore = ContinuousClock.now + config.backoffMinimum }
        if !stopped { wake() }
    }

    // MARK: Cycle

    private func isGmailMode() async throws -> Bool {
        // Connect first: a server that advertises X-GM-EXT-1 turns the account into a Gmail one (see `adoptGmailProvider`).
        let caps = try await run { await $0.capabilities }
        guard caps.gmail, let account = try await store.account(id: accountId), account.provider == .gmail else { return false }
        return try await store.folder(accountId: accountId, role: .all) != nil
    }

    private static let genericRoles: [MailboxRole] = [.inbox, .drafts, .sent, .archive, .spam, .trash]
    /// All Mail last: label and location changes settle first.
    private static let gmailRoles: [MailboxRole] = [.trash, .spam, .all]

    private func targets(_ folders: [Folder], gmail: Bool) async -> [Folder] {
        if gmail {
            return Self.gmailRoles.compactMap { role in folders.first { $0.role == role } }
        }
        let ordered = Self.genericRoles.compactMap { role in folders.first { $0.role == role } }
        var extra: [Folder] = []
        for folder in folders where folder.role == nil {
            if (try? await store.folderSyncState(folder.id))?.uidValidity != nil { extra.append(folder) }
        }
        return ordered + extra
    }

    private func makeEnvironment(gmail: Bool, collector: SyncCollector) async throws -> SyncEnvironment {
        let settings = try await store.settings()
        let folders = try await store.listFolders(accountId: accountId)
        var rolePaths: [MailboxRole: String] = [:]
        for folder in folders { if let role = folder.role, rolePaths[role] == nil { rolePaths[role] = folder.path } }
        return SyncEnvironment(
            store: store, accountId: accountId, gmail: gmail, now: now, initialDays: settings.sync.initialDays, rolePaths: rolePaths, collector: collector)
    }

    private func syncOne(_ folder: Folder, gmail: Bool, collector: SyncCollector) async throws {
        let environment = try await makeEnvironment(gmail: gmail, collector: collector)
        let mailbox = try await run { t in try await FolderSync.sync(environment.context(t), folder: folder) }
        syncedExists[folder.id] = mailbox.exists
    }

    private var syncedExists: [FolderID: Int] = [:]

    private func reconcile(_ folder: Folder, gmail: Bool) async throws {
        let exists = syncedExists[folder.id] ?? 0
        let periodic = config.reconcileEveryCycles > 0 && cycles % config.reconcileEveryCycles == 0
        if !periodic && lastExists[folder.id] == exists { return }
        let collector = SyncCollector()
        let environment = try await makeEnvironment(gmail: gmail, collector: collector)
        try await run { t in try await FolderSync.reconcileExpunges(environment.context(t), folder: folder) }
        lastExists[folder.id] = exists
        emitChanged(await collector.drain().changed)
    }

    private func syncCycle() async throws {
        setStatus(.syncing)
        let remote = try await run { try await $0.listFolders() }
        var folders: [Folder] = []
        for entry in FolderRoles.classify(remote) {
            folders.append(try await store.upsertFolder(
                accountId, FolderInput(path: entry.path, name: entry.name, delimiter: entry.delimiter, role: entry.role, specialUse: entry.specialUse)))
        }
        guard let account = try await store.account(id: accountId) else { throw FlintError(.notFound, "That account no longer exists.") }
        let caps = try await run { await $0.capabilities }
        // Gmail sync reads All Mail. When the user hides it from IMAP there is nothing to read the inbox from, so fall back
        // to the generic folder set instead of syncing an empty mailbox without any error.
        let gmail = account.provider == .gmail && caps.gmail && folders.contains { $0.role == .all }
        let picked = await targets(folders, gmail: gmail)
        let progress = SyncCollector(progress: { [weak self] value in Task { await self?.reportProgress(value) } })
        var pending: [SyncBatch] = []
        do {
            for folder in picked {
                try await syncOne(folder, gmail: gmail, collector: progress)
                let drained = await progress.drain()
                pending += drained.batches
                emitChanged(drained.changed)
            }
            cycles += 1
            for folder in picked { try await reconcile(folder, gmail: gmail) }
        } catch {
            // A dropped connection mid-sync must not lose the follow-up work for batches that were already ingested.
            let drained = await progress.drain()
            pending += drained.batches
            emitChanged(drained.changed)
            await afterBatches(pending, gmail: gmail)
            throw error
        }
        await afterBatches(pending, gmail: gmail)
        setStatus(.idle, lastSyncAt: now())
    }

    // MARK: After a batch

    /// Work that talks to the server again (rule actions, body prefetch) runs after the folder lock is released.
    private func afterBatches(_ batches: [SyncBatch], gmail: Bool) async {
        guard !batches.isEmpty else { return }
        let inboxPath = (try? await store.folder(accountId: accountId, role: .inbox))?.path
        let days = (try? await store.settings().sync.bodiesForRecentDays) ?? 14
        let outcomes = OutcomeRunner(store: store, accountId: accountId, actions: serverActions)
        for batch in batches {
            await prefetchBodies(batch, gmail: gmail, inboxPath: inboxPath, windowMs: days * millisecondsPerDay)
            guard batch.evaluated else { continue }
            emitChanged(await outcomes.apply(batch.outcomes))
            for event in await NewMail.events(store: store, accountId: accountId, batch: batch, inboxPath: inboxPath, now: now()) { emit(event) }
        }
    }

    private func prefetchBodies(_ batch: SyncBatch, gmail: Bool, inboxPath: String?, windowMs: Int) async {
        let cutoff = now() - windowMs
        let byUid = Dictionary(batch.items.map { ($0.uid, $0) }, uniquingKeysWith: { first, _ in first })
        let wanted = batch.outcomes.filter { outcome in
            guard let item = byUid[outcome.uid], item.date >= cutoff else { return false }
            if gmail { return inboxPath.map { item.gmLabels?.contains($0) ?? false } ?? false }
            return batch.folder.role == .inbox
        }
        guard !wanted.isEmpty else { return }
        let store = self.store
        let path = batch.folder.path
        // Small chunks, each under its own mailbox lock, so thread opens, attachment downloads and server actions queued on
        // the same connection are served between chunks instead of waiting for the whole batch.
        for chunk in chunked(wanted, size: config.prefetchChunk) {
            do {
                let changed: [ThreadID] = try await run { t in
                    try await t.withMailbox(path, readOnly: true) {
                        var changed: [ThreadID] = []
                        for outcome in chunk {
                            guard let body = try? await BodyLoader.load(t, uid: outcome.uid, structure: batch.structures[outcome.uid]) else { continue }
                            try await store.setBody(outcome.messageRowId, body)
                            changed.append(outcome.threadId)
                        }
                        return changed
                    }
                }
                emitChanged(changed)
            } catch {
                return // body prefetch is best effort; the next sync or an open fetches on demand
            }
        }
    }
}

/// One step of a server search: the folder to search and the criteria to send.
public struct ServerSearch: Hashable, Sendable {
    public var folderId: FolderID
    public var criteria: SearchCriteria

    public init(folderId: FolderID, criteria: SearchCriteria) {
        self.folderId = folderId
        self.criteria = criteria
    }
}
