// Shared types of the sync engine: the store slice it needs, one ingested batch, and the collector that survives
// a dropped connection.

import FlintModel
import FlintStore
import Foundation

/// The persistence the mail engine uses. `any Store` satisfies it; tests fake just these repositories.
public typealias MailEngineStore =
    AccountsRepository & FoldersRepository & IngestRepository & SettingsRepository & MessagesRepository & ThreadsRepository & PendingOpsRepository

/// One ingested batch, handed to the account session for follow-up work once the folder sync is done.
public struct SyncBatch: Sendable {
    public var folder: Folder
    public var items: [IngestMessage]
    public var outcomes: [IngestOutcome]
    public var structures: [Int: BodyPart]
    /// Rules and blocked senders were evaluated; false for history backfill and the initial window.
    public var evaluated: Bool
}

/// Collects batches and changed threads while a folder syncs. A dropped connection mid-sync must not lose the follow-up
/// work for batches that were already ingested (their rows exist, so a retry would not collect them again).
public actor SyncCollector {
    private(set) var batches: [SyncBatch] = []
    private var changed: [ThreadID] = []
    private var progressHandler: (@Sendable (SyncProgress) -> Void)?

    public init(progress: (@Sendable (SyncProgress) -> Void)? = nil) { progressHandler = progress }

    func add(_ batch: SyncBatch) {
        batches.append(batch)
        addChanged(batch.outcomes.flatMap { [$0.threadId] + $0.mergedThreadIds })
    }

    func addChanged(_ ids: [ThreadID]) {
        for id in ids where !changed.contains(id) { changed.append(id) }
    }

    func progress(_ value: SyncProgress) { progressHandler?(value) }

    /// Returns what was collected and clears it.
    func drain() -> (batches: [SyncBatch], changed: [ThreadID]) {
        defer { batches = []; changed = [] }
        return (batches, changed)
    }
}

/// What one folder sync needs. Value type; the collector is the only mutable piece.
public struct FolderSyncContext: Sendable {
    public var store: any MailEngineStore
    public var accountId: AccountID
    public var transport: any MailTransport
    public var gmail: Bool
    public var now: @Sendable () -> EpochMs
    /// Days of mail the initial window covers; 0 means everything.
    public var initialDays: Int
    /// Gmail only: role to folder path, for turning X-GM-LABELS system labels into folder paths.
    public var rolePaths: [MailboxRole: String]
    public var collector: SyncCollector

    public init(
        store: any MailEngineStore, accountId: AccountID, transport: any MailTransport, gmail: Bool, now: @escaping @Sendable () -> EpochMs,
        initialDays: Int, rolePaths: [MailboxRole: String], collector: SyncCollector
    ) {
        self.store = store
        self.accountId = accountId
        self.transport = transport
        self.gmail = gmail
        self.now = now
        self.initialDays = initialDays
        self.rolePaths = rolePaths
        self.collector = collector
    }

    func labelPaths(_ labels: [String]) -> [String] {
        FolderRoles.gmailLabelPaths(labels, pathForRole: { rolePaths[$0] })
    }
}

/// Everything a folder sync needs except the connection, so a session can prepare it before it holds the command lock.
public struct SyncEnvironment: Sendable {
    public var store: any MailEngineStore
    public var accountId: AccountID
    public var gmail: Bool
    public var now: @Sendable () -> EpochMs
    public var initialDays: Int
    public var rolePaths: [MailboxRole: String]
    public var collector: SyncCollector

    public func context(_ transport: any MailTransport) -> FolderSyncContext {
        FolderSyncContext(
            store: store, accountId: accountId, transport: transport, gmail: gmail, now: now, initialDays: initialDays, rolePaths: rolePaths,
            collector: collector)
    }
}

public func chunked<T>(_ list: [T], size: Int) -> [[T]] {
    guard size > 0 else { return [list] }
    return stride(from: 0, to: list.count, by: size).map { Array(list[$0..<min($0 + size, list.count)]) }
}

let millisecondsPerDay = 24 * 60 * 60 * 1000
