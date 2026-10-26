// The optimistic action pipeline: local store change, "mail changed", server operation. When the server refuses, the
// affected threads are restored and a toast explains. Server operations are written to `pending_ops` while they run, so
// one that was interrupted (the app was killed mid-action) is replayed on the next launch.
// Port of packages/core/src/service/optimistic.ts and pendingOps.ts.

import FlintModel
import FlintStore
import Foundation

public struct OptimisticSpec: Sendable {
    /// Past the "Couldn't ..." in the failure toast, for example "archive".
    public var label: String
    /// Applies the change to the store and returns what the server has to do.
    public var local: @Sendable () async throws -> ActionResult
    /// Server follow-up. Omit for local-only actions such as snooze and mute.
    public var server: ServerOp?
    /// What `server` does, in a form that survives a restart. When set, the operation is recorded before it runs.
    public var op: PendingOpSpec?
    /// Server operation that undoes the change after the store was restored.
    public var inverse: InverseOp?

    public init(label: String, local: @escaping @Sendable () async throws -> ActionResult, server: ServerOp? = nil, op: PendingOpSpec? = nil, inverse: InverseOp? = nil) {
        self.label = label
        self.local = local
        self.server = server
        self.op = op
        self.inverse = inverse
    }
}

public enum PendingOpReplay {
    /// Failed replays tolerated before a recorded operation is dropped (sync then settles the mailbox).
    public static let maxAttempts = 3
    /// Age after which a recorded operation is dropped without a retry.
    public static let maxAgeMs = 24 * 60 * 60 * 1000

    /// Runs a recorded operation against the server.
    public static func apply(_ actions: ServerActions, _ spec: PendingOpSpec, _ locs: [MessageLocation]) async -> ActionReport {
        switch spec.kind {
        case .seen: return await actions.setSeen(locs, spec.arg == .flag(true))
        case .flagged: return await actions.setFlagged(locs, spec.arg == .flag(true))
        case .archive: return await actions.archive(locs)
        case .trash: return await actions.trash(locs)
        case .spam: return await actions.spam(locs)
        case .unspam: return await actions.unspam(locs)
        case .moveInbox: return await actions.moveToInbox(locs)
        case .moveFolder:
            guard case .folder(let id) = spec.arg else { return ActionReport(errors: locs.map { ActionError(op: "moveToFolder", messageRowId: $0.messageRowId, folderPath: $0.folderPath, uid: $0.uid, message: "The recorded move has no folder.") }) }
            return await actions.moveToFolder(locs, id)
        }
    }
}

public actor OptimisticActions {
    public typealias ActionsProvider = @Sendable (AccountID) -> ServerActions?

    private let store: any MailEngineStore
    private let emit: @Sendable (FlintEvent) -> Void
    private let undoRegistry: UndoRegistry
    private let actionsFor: ActionsProvider
    private let now: @Sendable () -> EpochMs

    public init(
        store: any MailEngineStore, emit: @escaping @Sendable (FlintEvent) -> Void, undo: UndoRegistry = UndoRegistry(),
        actionsFor: @escaping ActionsProvider, now: @escaping @Sendable () -> EpochMs = { Int(Date().timeIntervalSince1970 * 1000) }
    ) {
        self.store = store
        self.emit = emit
        self.undoRegistry = undo
        self.actionsFor = actionsFor
        self.now = now
    }

    // MARK: Running actions

    /// Applies `spec` and returns the undo token (valid for 30 seconds).
    public func run(_ spec: OptimisticSpec) async throws -> String {
        let result = try await spec.local()
        let threadIds = result.snapshot.threads.map(\.id)
        let token = await undoRegistry.register(UndoEntry(
            label: spec.label, snapshot: result.snapshot, affected: result.locations.map(\.messageRowId), inverse: spec.inverse))
        changed(await accountsOf(threadIds))
        guard let server = spec.server, !result.locations.isEmpty else { return token }

        let failed = await runOnServer(result.locations, durable(spec, server))
        guard !failed.isEmpty else { return token }
        let restored = try await store.restoreSnapshot(Self.failedPart(result.snapshot, failed))
        changed(await accountsOf(restored))
        await undoRegistry.discard(token)
        emit(.toast(.error, message: "Couldn't \(spec.label). The change was undone.", undoToken: nil))
        return token
    }

    /// Restores the store from the token's snapshot, then runs the inverse on the server.
    public func undo(_ token: String) async throws {
        let entry = try await undoRegistry.take(token)
        let threadIds = try await store.restoreSnapshot(entry.snapshot)
        changed(await accountsOf(threadIds))
        guard let inverse = entry.inverse else { return }
        let locs = try await store.messageLocations(entry.affected)
        let failed = await runOnServer(locs) { actions, group in await inverse(actions, group, entry.snapshot) }
        if !failed.isEmpty {
            emit(.toast(.error, message: "Couldn't undo \(entry.label) on the server. It will correct itself on the next sync.", undoToken: nil))
        }
    }

    /// Re-runs server operations that were recorded but never finished. Returns how many were attempted.
    public func replayPending() async -> Int {
        let current = now()
        var ran = 0
        guard let ops = try? await store.listPendingOps() else { return 0 }
        for op in ops {
            if current - op.createdAt > PendingOpReplay.maxAgeMs { try? await store.removePendingOp(op.id); continue }
            if await replayOne(op) { ran += 1 }
        }
        return ran
    }

    public func accountsOf(_ threadIds: [ThreadID]) async -> [(accountId: AccountID, threadIds: [ThreadID])] {
        guard let locs = try? await store.threadLocations(threadIds) else { return [] }
        var order: [AccountID] = []
        var grouped: [AccountID: [ThreadID]] = [:]
        for loc in locs {
            if grouped[loc.accountId] == nil { order.append(loc.accountId) }
            if !(grouped[loc.accountId]?.contains(loc.threadId) ?? false) { grouped[loc.accountId, default: []].append(loc.threadId) }
        }
        return order.map { ($0, grouped[$0] ?? []) }
    }

    // MARK: Internals

    private func changed(_ byAccount: [(accountId: AccountID, threadIds: [ThreadID])]) {
        for entry in byAccount { emit(.mailChanged(accountId: entry.accountId, threadIds: entry.threadIds)) }
    }

    /// The server operation wrapped so it is on disk while it runs. A crash leaves the row behind for `replayPending`.
    private func durable(_ spec: OptimisticSpec, _ server: @escaping ServerOp) -> ServerOp {
        guard let op = spec.op else { return server }
        let store = self.store
        let now = self.now
        return { actions, group in
            let id: Int?
            if let accountId = group.first?.accountId {
                id = try? await store.addPendingOp(accountId: accountId, op, messageIds: group.map(\.messageRowId), now: now())
            } else {
                id = nil
            }
            let report = await server(actions, group)
            if let id { try? await store.removePendingOp(id) }
            return report
        }
    }

    private func replayOne(_ op: PendingOp) async -> Bool {
        guard let locs = try? await store.messageLocations(op.messageIds) else { return false }
        if locs.isEmpty { try? await store.removePendingOp(op.id); return true }
        let failed = await runOnServer(locs) { actions, group in await PendingOpReplay.apply(actions, op.spec, group) }
        if failed.isEmpty { try? await store.removePendingOp(op.id); return true }
        let attempts = (try? await store.bumpPendingOp(op.id, error: "server refused the replayed operation")) ?? PendingOpReplay.maxAttempts
        if attempts >= PendingOpReplay.maxAttempts { try? await store.removePendingOp(op.id) }
        return true
    }

    /// Messages whose server operation failed, across accounts. A whole account fails when it has no session.
    private func runOnServer(_ locs: [MessageLocation], _ op: ServerOp) async -> Set<MessageRowID> {
        var failed = Set<MessageRowID>()
        var order: [AccountID] = []
        var byAccount: [AccountID: [MessageLocation]] = [:]
        for loc in locs {
            if byAccount[loc.accountId] == nil { order.append(loc.accountId) }
            byAccount[loc.accountId, default: []].append(loc)
        }
        for accountId in order {
            let group = byAccount[accountId] ?? []
            guard let actions = actionsFor(accountId) else { failed.formUnion(group.map(\.messageRowId)); continue }
            let report = await op(actions, group)
            if !report.ok { failed.formUnion(report.failedMessageIds) }
        }
        return failed
    }

    /// Only the threads that hold a failed message, so threads that did reach the server keep their new state.
    private static func failedPart(_ snapshot: ThreadSnapshot, _ failed: Set<MessageRowID>) -> ThreadSnapshot {
        ThreadSnapshot(version: snapshot.version, threads: snapshot.threads.filter { thread in thread.messages.contains { failed.contains($0.id) } })
    }
}
