// The two small interfaces the account layer (2C) calls back into: what to do with an account's sync when it changes, and
// what to show when a sign-in stops working. Created before the sync manager exists, so the manager is bound afterwards.

import FlintMail
import FlintModel
import Foundation
import Synchronization

final class ServiceHooks: AccountLifecycle, AuthFailureSink, Sendable {
    private struct Bound {
        var sync: SyncManager
        var emit: @Sendable (FlintEvent) -> Void
        var cacheDirectory: URL
    }

    private let bound = Mutex<Bound?>(nil)

    func bind(sync: SyncManager, emit: @escaping @Sendable (FlintEvent) -> Void, cacheDirectory: URL) {
        bound.withLock { $0 = Bound(sync: sync, emit: emit, cacheDirectory: cacheDirectory) }
    }

    func restartSync(_ id: AccountID) async {
        guard let sync = bound.withLock({ $0?.sync }) else { return }
        await sync.restart(id)
    }

    func forgetSync(_ id: AccountID) async {
        guard let b = bound.withLock({ $0 }) else { return }
        await b.sync.forget(id)
        // The attachment cache of a removed account goes with it.
        let folder = b.cacheDirectory.appendingPathComponent("attachments", isDirectory: true)
            .appendingPathComponent(AttachmentCache.safeFilename(id, fallback: "account"), isDirectory: true)
        try? FileManager.default.removeItem(at: folder)
    }

    func accountChanged(_ id: AccountID) async {
        guard let emit = bound.withLock({ $0?.emit }) else { return }
        // No thread ids: lists, the sidebar and the account list refetch.
        emit(.mailChanged(accountId: id, threadIds: []))
    }

    func authFailed(accountID: AccountID, message: String) async {
        bound.withLock { $0?.sync }?.authFailed(accountID, message: message)
    }
}
