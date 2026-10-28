import FlintModel
import FlintService
import Foundation

/// Reading mail. These throw `FlintError`; a screen shows `ErrorBanner(error:)` or its own empty state.
extension AppModel {
    /// One page of a list. Pass the previous page's `nextCursor` as `query.cursor` for the next one.
    func listThreads(_ query: ThreadQuery) async throws -> ThreadPage {
        try await requireService().listThreads(query)
    }

    /// First page of a list as a stream: a value now and again whenever mail changes. Cancel the iterating task to stop.
    func threadPages(_ query: ThreadQuery) -> AsyncThrowingStream<ThreadPage, Error> {
        guard let service else { return AsyncThrowingStream { $0.finish(throwing: FlintError(.internal, "Flint is still starting.")) } }
        return service.threads(query)
    }

    /// Fetches the next batch of older mail from the server for this list.
    func loadOlder(_ query: ThreadQuery) async throws -> LoadOlderResult {
        try await requireService().loadOlder(query)
    }

    func threadDetail(_ id: ThreadID) async throws -> ThreadDetail {
        try await requireService().thread(id: id)
    }

    /// A conversation as a stream: bodies that are not stored yet arrive as later values.
    func threadStream(_ id: ThreadID) -> AsyncThrowingStream<ThreadDetail, Error> {
        guard let service else { return AsyncThrowingStream { $0.finish(throwing: FlintError(.internal, "Flint is still starting.")) } }
        return service.thread(id)
    }

    func message(_ id: MessageRowID) async throws -> MessageView {
        try await requireService().message(id: id)
    }

    func allowRemoteImages(messageId: MessageRowID, always: Bool) async throws -> MessageView {
        try await requireService().allowRemoteImages(messageId: messageId, always: always)
    }

    func folders(accountId: AccountID) async throws -> [Folder] {
        try await requireService().folders(accountId: accountId)
    }

    /// A file for Quick Look or the share sheet.
    func attachmentFile(_ attachmentId: Int) async throws -> URL {
        try await requireService().attachmentFile(attachmentId)
    }

    func suggestContacts(prefix: String, limit: Int = 8) async throws -> [Contact] {
        try await requireService().suggestContacts(prefix: prefix, limit: limit)
    }

    func drafts() -> AsyncThrowingStream<[Draft], Error> {
        guard let service else { return AsyncThrowingStream { $0.finish(throwing: FlintError(.internal, "Flint is still starting.")) } }
        return service.drafts()
    }

    func scheduled() -> AsyncThrowingStream<[ScheduledSend], Error> {
        guard let service else { return AsyncThrowingStream { $0.finish(throwing: FlintError(.internal, "Flint is still starting.")) } }
        return service.scheduled()
    }

    // MARK: Search

    /// Local search over every account (or one). Operators: from: to: subject: has:attachment is:unread in: before: after: account:
    func search(_ text: String, accountId: AccountID? = nil, limit: Int = 50, cursor: String? = nil) async throws -> ThreadPage {
        let query = ThreadQuery(view: .search, accountId: accountId, search: text, cursor: cursor, limit: limit)
        return try await requireService().listThreads(query)
    }

    /// Asks the mail servers too, and stores matches that are not on the device yet. Run `search` again afterwards.
    func searchServer(_ text: String, accountId: AccountID? = nil) async throws -> ServerSearchResult {
        try await requireService().searchServer(text, accountId: accountId)
    }

    /// Remembers a search for the Recents list (newest first, at most eight). Demo launches keep them in memory only.
    func recordSearch(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        recentSearches = Array(([trimmed] + recentSearches.filter { $0 != trimmed }).prefix(8))
        if !isDemo { defaults.set(recentSearches, forKey: Self.recentsKey) }
    }

    func clearRecentSearches() {
        recentSearches = []
        if !isDemo { defaults.removeObject(forKey: Self.recentsKey) }
    }
}
