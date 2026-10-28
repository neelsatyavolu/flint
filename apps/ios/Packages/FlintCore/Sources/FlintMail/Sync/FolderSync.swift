// Brings one folder up to date: initial window, new mail, flag changes, vanished mail, history and server search.
// Port of packages/core/src/mail/sync/folderSync.ts and history.ts, extended with QRESYNC.

import FlintModel
import FlintStore
import Foundation

public enum FolderSync {
    public static let batchSize = 200
    static let flagChunk = 500
    /// UIDs fetched per `loadOlder` call and folder.
    public static let backfillBatch = 500
    /// Messages a server search brings in per folder, newest first.
    public static let serverSearchCap = 200

    static func envelopeOptions(gmail: Bool) -> EnvelopeFetchOptions {
        EnvelopeFetchOptions(bodyStructure: true, headers: MailHeaders.fetchHeaders, gmail: gmail)
    }

    /// Fetches, maps and stores these UIDs. The folder must be selected.
    public static func ingest(_ c: FolderSyncContext, folder: Folder, uids: [Int], evaluate: Bool) async throws {
        let fetched = try await c.transport.fetchEnvelopes(.uids(uids), options: envelopeOptions(gmail: c.gmail))
        let wanted = Set(uids)
        let envelopes = fetched.filter { wanted.contains($0.uid) }.sorted { $0.uid < $1.uid }
        guard !envelopes.isEmpty else { return }
        let now = c.now()
        let items = envelopes.map { EnvelopeMapping.ingestMessage($0, gmail: c.gmail, labelPaths: c.gmail ? { c.labelPaths($0) } : nil, now: now) }
        let outcomes = try await c.store.ingestMessages(c.accountId, folder.id, items, context: IngestContext(now: now, evaluate: evaluate))
        var structures: [Int: BodyPart] = [:]
        for env in envelopes { if let tree = env.bodyStructure { structures[env.uid] = tree } }
        await c.collector.add(SyncBatch(folder: folder, items: items, outcomes: outcomes, structures: structures, evaluated: evaluate))
    }

    /// Brings one folder up to date. A changed UIDVALIDITY drops the folder's messages and starts over.
    /// Returns the mailbox as selected, so the caller can see its message count.
    @discardableResult
    public static func sync(_ c: FolderSyncContext, folder: Folder) async throws -> SelectedMailbox {
        var state = try await c.store.folderSyncState(folder.id)
        let caps = await c.transport.capabilities
        var resync: QResyncState?
        if caps.qresync, let validity = state.uidValidity, let modseq = state.highestModseq.flatMap(UInt64.init) {
            resync = QResyncState(uidValidity: validity, highestModseq: modseq)
        }
        let selected = try await c.transport.select(folder.path, readOnly: true, qresync: resync)
        if let known = state.uidValidity, known != selected.mailbox.uidValidity {
            await c.collector.addChanged(try await c.store.resetFolder(folder.id))
            state = try await c.store.folderSyncState(folder.id)
        }
        if state.uidNext == nil {
            try await initialSync(c, folder: folder, mailbox: selected.mailbox, state: state)
        } else {
            try await incrementalSync(c, folder: folder, selected: selected, state: state, caps: caps)
        }
        return selected.mailbox
    }

    private static func initialSync(_ c: FolderSyncContext, folder: Folder, mailbox: SelectedMailbox, state: FolderSyncState) async throws {
        let criteria: SearchCriteria = c.initialDays > 0
            ? .since(EnvelopeMapping.date(fromEpochMs: c.now() - c.initialDays * millisecondsPerDay)) : .all
        let found = try await c.transport.search(criteria)
        let local = Set(try await c.store.listLocalUids(folder.id, minUid: 0))
        let uids = found.filter { !local.contains($0) }.sorted(by: >) // newest first
        var done = 0
        var minUid: Int?
        for batch in chunked(uids, size: batchSize) {
            try await ingest(c, folder: folder, uids: batch, evaluate: false)
            done += batch.count
            minUid = min(minUid ?? .max, batch.min() ?? .max)
            try await c.store.setFolderSyncState(folder.id, FolderSyncPatch(syncedMinUid: .some(minUid)))
            await c.collector.progress(SyncProgress(done: done, total: uids.count, folder: folder.name))
        }
        try await c.store.setFolderSyncState(folder.id, FolderSyncPatch(
            uidValidity: .some(mailbox.uidValidity), uidNext: .some(mailbox.uidNext),
            highestModseq: .some(mailbox.highestModseq.map(String.init)),
            syncedMinUid: .some(minUid ?? state.syncedMinUid ?? mailbox.uidNext), lastSyncAt: .some(c.now())))
    }

    private static func incrementalSync(
        _ c: FolderSyncContext, folder: Folder, selected: SelectResult, state: FolderSyncState, caps: TransportCapabilities
    ) async throws {
        let mailbox = selected.mailbox
        let uidNext = state.uidNext ?? 1
        if mailbox.uidNext > uidNext {
            let found = try await c.transport.search(.uid(.range(from: uidNext, to: nil)))
            let fresh = found.filter { $0 >= uidNext }.sorted()
            for batch in chunked(fresh, size: batchSize) { try await ingest(c, folder: folder, uids: batch, evaluate: true) }
        }
        try await syncFlags(c, folder: folder, selected: selected, state: state, caps: caps)
        try await c.store.setFolderSyncState(folder.id, FolderSyncPatch(
            uidNext: .some(mailbox.uidNext), highestModseq: .some(mailbox.highestModseq.map(String.init)), lastSyncAt: .some(c.now())))
    }

    /// QRESYNC servers report vanished mail and flag changes on SELECT. With CONDSTORE and CHANGEDSINCE only the changed
    /// rows are fetched. Without them (Gmail through this transport, most others) the synced window is re-fetched in chunks.
    private static func syncFlags(
        _ c: FolderSyncContext, folder: Folder, selected: SelectResult, state: FolderSyncState, caps: TransportCapabilities
    ) async throws {
        var changed = Set<ThreadID>()
        var rows: [FlagState] = []
        if selected.resynced {
            if !selected.vanishedUIDs.isEmpty { changed.formUnion(try await c.store.removeUids(folder.id, selected.vanishedUIDs)) }
            rows = selected.changedFlags
        } else if let stored = state.highestModseq.flatMap(UInt64.init), let current = selected.mailbox.highestModseq, caps.condstore {
            if stored >= current { return }
            rows = try await c.transport.fetchFlags(.range(from: 1, to: nil), includeLabels: c.gmail, changedSince: stored)
        } else {
            let local = try await c.store.listLocalUids(folder.id, minUid: state.syncedMinUid ?? 0)
            for part in chunked(local, size: flagChunk) {
                rows += try await c.transport.fetchFlags(.uids(part), includeLabels: c.gmail, changedSince: nil)
            }
        }
        if !rows.isEmpty {
            changed.formUnion(try await c.store.applyFlags(folder.id, rows.map(EnvelopeMapping.flagUpdate)))
            if c.gmail {
                let labelled = rows.compactMap { row in row.labels.map { (uid: row.uid, labels: c.labelPaths($0)) } }
                if !labelled.isEmpty { changed.formUnion(try await c.store.applyGmailLabels(folder.id, labelled)) }
            }
        }
        await c.collector.addChanged(Array(changed))
    }

    /// Removes local messages whose UID no longer exists on the server (within the synced window). Selects the folder.
    public static func reconcileExpunges(_ c: FolderSyncContext, folder: Folder) async throws {
        let state = try await c.store.folderSyncState(folder.id)
        guard state.uidNext != nil else { return }
        let min = state.syncedMinUid ?? 1
        _ = try await c.transport.select(folder.path, readOnly: true, qresync: nil)
        let remote = Set(try await c.transport.search(.uid(.range(from: min, to: nil))))
        let gone = try await c.store.listLocalUids(folder.id, minUid: min).filter { !remote.contains($0) }
        if !gone.isEmpty { await c.collector.addChanged(try await c.store.removeUids(folder.id, gone)) }
    }

    // MARK: History

    public struct BackfillResult: Hashable, Sendable {
        public var loaded: Int
        public var hasMore: Bool
    }

    /// Fetches the next older batch below the lowest UID synced so far. Rules and blocked senders are not evaluated on
    /// history. `syncedMinUid` drops to the oldest UID fetched; when nothing older is left it becomes 1, which is how
    /// the UI learns the folder is complete.
    public static func backfill(_ c: FolderSyncContext, folder: Folder, batch: Int = backfillBatch) async throws -> BackfillResult {
        let state = try await c.store.folderSyncState(folder.id)
        guard state.uidNext != nil, let min = state.syncedMinUid, min > 1 else { return BackfillResult(loaded: 0, hasMore: false) }
        _ = try await c.transport.select(folder.path, readOnly: true, qresync: nil)
        let local = Set(try await c.store.listLocalUids(folder.id, minUid: 0))
        let older = try await c.transport.search(.uid(.range(from: 1, to: min - 1))).filter { $0 < min }.sorted(by: >)
        if older.isEmpty {
            try await c.store.setFolderSyncState(folder.id, FolderSyncPatch(syncedMinUid: .some(1)))
            return BackfillResult(loaded: 0, hasMore: false)
        }
        let take = Array(older.prefix(batch))
        let fresh = take.filter { !local.contains($0) }
        var loaded = 0
        for part in chunked(fresh, size: batchSize) {
            try await ingest(c, folder: folder, uids: part, evaluate: false)
            loaded += part.count
            await c.collector.progress(SyncProgress(done: loaded, total: fresh.count, folder: folder.name))
        }
        let rest = older.count - take.count
        try await c.store.setFolderSyncState(folder.id, FolderSyncPatch(syncedMinUid: .some(rest > 0 ? take.last : 1)))
        return BackfillResult(loaded: loaded, hasMore: rest > 0)
    }

    /// Runs a server-side search in one folder and ingests the matches that are not local yet (newest first, capped).
    /// Returns how many messages the server matched and how many were new here.
    public static func search(
        _ c: FolderSyncContext, folder: Folder, criteria: SearchCriteria, cap: Int = serverSearchCap
    ) async throws -> (found: Int, added: Int) {
        _ = try await c.transport.select(folder.path, readOnly: true, qresync: nil)
        let found = try await c.transport.search(criteria)
        let local = Set(try await c.store.listLocalUids(folder.id, minUid: 0))
        let fresh = Array(found.filter { !local.contains($0) }.sorted(by: >).prefix(cap))
        for part in chunked(fresh, size: batchSize) { try await ingest(c, folder: folder, uids: part, evaluate: false) }
        return (found.count, fresh.count)
    }
}
