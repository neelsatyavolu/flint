// Observable streams: a value now, and again whenever it changes. Each stream is cheap (one listener, coalesced refetches), so a
// screen subscribes to exactly what it shows and cancels the iteration when it goes away.

import FlintModel
import FlintStore
import Foundation

extension FlintService {
    /// A thread list. Refetches when mail changes in a way that can affect it, a send changes state, or a code arrives.
    /// For paging, call `listThreads(_:)` with the cursor; the stream always shows the first page.
    public func threads(_ query: ThreadQuery) -> AsyncThrowingStream<ThreadPage, Error> {
        let first = ThreadQuery(
            view: query.view, accountId: query.accountId, folderId: query.folderId, search: query.search, focused: query.focused,
            category: query.category, unreadOnly: query.unreadOnly, hasAttachments: query.hasAttachments, sort: query.sort, cursor: nil,
            limit: query.limit)
        let core = self.core
        let accountId = query.accountId
        return core.bus.observe(matching: { event in
            switch event {
            case .mailChanged(let id, _): return accountId == nil || accountId == id
            case .send, .code: return true
            default: return false
            }
        }, fetch: { try await core.listThreads(first) })
    }

    /// One conversation as the reader shows it. Missing bodies arrive as later values.
    public func thread(_ id: ThreadID) -> AsyncThrowingStream<ThreadDetail, Error> {
        let core = self.core
        return core.bus.observe(matching: { event in
            switch event {
            case .mailChanged(_, let ids): return ids.isEmpty || ids.contains(id)
            case .receipt, .code, .settings: return true
            default: return false
            }
        }, fetch: { try await core.threadDetail(id) })
    }

    /// Accounts with their folders, unread counts and sync state, plus the counts for Pins, Drafts, Snoozed, Scheduled and Spam.
    public func sidebar() -> AsyncThrowingStream<SidebarData, Error> {
        let core = self.core
        return core.bus.observe(matching: { event in
            switch event {
            case .mailChanged, .sync, .send: return true
            default: return false
            }
        }, fetch: { try await core.sidebar() })
    }

    public func folders(accountId: AccountID) -> AsyncThrowingStream<[Folder], Error> {
        let core = self.core
        return core.bus.observe(matching: { event in
            if case .mailChanged(let id, _) = event { return id == accountId }
            return false
        }, fetch: { try await core.store.listFolders(accountId: accountId) })
    }

    public func accounts() -> AsyncThrowingStream<[Account], Error> {
        let core = self.core
        return core.bus.observe(matching: EventFilters.accountsChanged, fetch: { try await core.store.listAccounts() })
    }

    /// The sync state of every account (idle, syncing with progress, offline, error, or sign in again).
    public func syncStatus() -> AsyncThrowingStream<[SyncStatus], Error> {
        let core = self.core
        return core.bus.observe(matching: EventFilters.sync, fetch: { core.sync.statuses(for: try await core.store.listAccounts()) })
    }

    public func settings() -> AsyncThrowingStream<Settings, Error> {
        let core = self.core
        return core.bus.observe(matching: EventFilters.settings, fetch: { try await core.store.settings() })
    }

    public func drafts() -> AsyncThrowingStream<[Draft], Error> {
        let core = self.core
        return core.bus.observe(matching: { event in
            switch event {
            case .mailChanged, .send: return true
            default: return false
            }
        }, fetch: { try await core.listDrafts() })
    }

    /// Sends waiting for their undo window or a chosen time, and ones that failed.
    public func scheduled() -> AsyncThrowingStream<[ScheduledSend], Error> {
        let core = self.core
        return core.bus.observe(matching: { event in
            if case .send = event { return true }
            return false
        }, fetch: { try await core.sendQueue.listScheduled() })
    }

    /// Read receipts, newest first. `unopened` filters to mail nobody opened; false to mail somebody did.
    public func tracked(limit: Int? = 100, unopened: Bool? = nil) -> AsyncThrowingStream<[TrackedMessage], Error> {
        let core = self.core
        return core.bus.observe(matching: EventFilters.receipt, fetch: { try await core.store.listTracked(limit: limit, unopenedOnly: unopened) })
    }

    /// Verification codes from the last ten minutes, newest first.
    public func codes() -> AsyncThrowingStream<[VerificationCode], Error> {
        let core = self.core
        return core.bus.observe(matching: { event in
            switch event {
            case .code, .mailChanged: return true
            default: return false
            }
        }, fetch: { await core.codes.list() })
    }
}
