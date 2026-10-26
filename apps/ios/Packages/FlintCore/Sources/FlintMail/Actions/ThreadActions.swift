// The thread actions the UI calls, each as an optimistic local change plus a server operation. The Swift analogue of
// packages/core/src/service/actions.ts without snooze (store only, owned by the service facade).

import FlintModel
import FlintStore
import Foundation

public struct ThreadActions: Sendable {
    public static let maxThreads = 5000

    private let store: any MailEngineStore
    private let pipeline: OptimisticActions

    public init(store: any MailEngineStore, pipeline: OptimisticActions) {
        self.store = store
        self.pipeline = pipeline
    }

    private func checked(_ ids: [ThreadID]) throws -> [ThreadID] {
        guard ids.count <= Self.maxThreads, ids.allSatisfy({ $0 > 0 }) else { throw FlintError(.invalid, "That selection isn't valid.") }
        return ids
    }

    public func markRead(_ ids: [ThreadID], read: Bool) async throws -> String {
        let t = try checked(ids)
        let store = self.store
        return try await pipeline.run(OptimisticSpec(
            label: read ? "mark as read" : "mark as unread", local: { try await store.markRead(t, read: read) },
            server: { actions, locs in await actions.setSeen(locs, read) }, op: PendingOpSpec(kind: .seen, arg: .flag(read)), inverse: InverseOps.seen))
    }

    public func setPinned(_ ids: [ThreadID], pinned: Bool) async throws -> String {
        let t = try checked(ids)
        let store = self.store
        return try await pipeline.run(OptimisticSpec(
            label: pinned ? "pin" : "unpin", local: { try await store.setPinned(t, pinned: pinned) },
            server: { actions, locs in await actions.setFlagged(locs, pinned) }, op: PendingOpSpec(kind: .flagged, arg: .flag(pinned)), inverse: InverseOps.flagged))
    }

    public func archive(_ ids: [ThreadID]) async throws -> String {
        try await move(ids, label: "archive", target: .archive, op: PendingOpSpec(kind: .archive)) { await $0.archive($1) }
    }

    public func trash(_ ids: [ThreadID]) async throws -> String {
        try await ensureRoleFolders(ids, role: .trash)
        return try await move(ids, label: "move to Trash", target: .trash, op: PendingOpSpec(kind: .trash)) { await $0.trash($1) }
    }

    public func markSpam(_ ids: [ThreadID], spam: Bool) async throws -> String {
        if spam {
            try await ensureRoleFolders(ids, role: .spam)
            return try await move(ids, label: "mark as spam", target: .spam, op: PendingOpSpec(kind: .spam)) { await $0.spam($1) }
        }
        return try await move(ids, label: "mark as not spam", target: .inbox, op: PendingOpSpec(kind: .unspam)) { await $0.unspam($1) }
    }

    public func moveToFolder(_ ids: [ThreadID], folderId: FolderID) async throws -> String {
        try await move(ids, label: "move", target: .folder(folderId), op: PendingOpSpec(kind: .moveFolder, arg: .folder(folderId))) { await $0.moveToFolder($1, folderId) }
    }

    public func moveToInbox(_ ids: [ThreadID]) async throws -> String {
        try await move(ids, label: "move to the inbox", target: .inbox, op: PendingOpSpec(kind: .moveInbox)) { await $0.moveToInbox($1) }
    }

    public func undo(_ token: String) async throws { try await pipeline.undo(token) }

    private func move(_ ids: [ThreadID], label: String, target: MoveTarget, op: PendingOpSpec, server: @escaping ServerOp) async throws -> String {
        let t = try checked(ids)
        let store = self.store
        return try await pipeline.run(OptimisticSpec(
            label: label, local: { try await store.moveThreads(t, to: target) }, server: server, op: op, inverse: InverseOps.move(store)))
    }

    /// Servers like GreenMail have no Trash or Junk folder until something is moved there. Creates the local row for each
    /// account involved (the move creates the mailbox on the server) so `moveThreads` does not fail with not_found.
    private func ensureRoleFolders(_ ids: [ThreadID], role: MailboxRole) async throws {
        for entry in await pipeline.accountsOf(try checked(ids)) { _ = try? await store.ensureFolder(accountId: entry.accountId, role: role) }
    }
}
