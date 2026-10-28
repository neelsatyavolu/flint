// Reading mail and acting on it.

import FlintMail
import FlintModel
import FlintStore
import Foundation

extension FlintService {
    // MARK: Reading

    /// One page of a thread list. Pass `nextCursor` of the previous page as `query.cursor` for the next one.
    public func listThreads(_ query: ThreadQuery) async throws -> ThreadPage { try await core.listThreads(query) }

    /// Fetches the next batch of mail older than what is synced for the folders behind this list.
    public func loadOlder(_ query: ThreadQuery) async throws -> LoadOlderResult { try await core.loadOlder(query) }

    /// Asks the mail servers about this query and stores matches that are not on the device yet; local search then finds them.
    public func searchServer(_ search: String, accountId: AccountID? = nil) async throws -> ServerSearchResult {
        try await core.searchServer(search, accountId: accountId)
    }

    /// A conversation with sanitized HTML. Bodies that are not stored are fetched first, for a moment at most.
    public func thread(id: ThreadID) async throws -> ThreadDetail { try await core.threadDetail(id) }

    public func message(id: MessageRowID) async throws -> MessageView { try await core.messageView(id) }

    /// Loads remote images for this message (and remembers the sender when `always`). Returns the message as the reader shows it.
    public func allowRemoteImages(messageId: MessageRowID, always: Bool) async throws -> MessageView {
        guard let row = try await core.store.message(id: messageId) else { throw FlintError(.notFound, "That message no longer exists.") }
        try await core.allowImages(messageId: messageId, from: row.from, always: always)
        core.emit(.mailChanged(accountId: row.accountId, threadIds: [row.threadId]))
        return try await core.messageView(messageId)
    }

    public func folders(accountId: AccountID) async throws -> [Folder] {
        guard try await core.store.account(id: accountId) != nil else { throw FlintError(.notFound, "No such account.") }
        return try await core.store.listFolders(accountId: accountId)
    }

    public func suggestContacts(prefix: String, limit: Int = 8) async throws -> [Contact] {
        try await core.store.suggestContacts(prefix: prefix, limit: limit)
    }

    /// The attachment's bytes, downloaded once and then served from the cache. The reader's `flint-attachment://<id>` scheme uses this.
    public func attachmentData(_ attachmentId: Int) async throws -> Data {
        try await core.attachmentSession(attachmentId).fetchAttachment(attachmentId)
    }

    /// A file the UI can hand to Quick Look or the share sheet. The name is the attachment's own, kept unique in a per-attachment folder.
    public func attachmentFile(_ attachmentId: Int) async throws -> URL {
        let session = try await core.attachmentSession(attachmentId)
        guard let attachment = try await core.store.attachment(id: attachmentId) else { throw FlintError(.notFound, "That attachment no longer exists.") }
        let data = try await session.fetchAttachment(attachmentId)
        let folder = core.config.cacheDirectory.appendingPathComponent("opened", isDirectory: true).appendingPathComponent(String(attachmentId), isDirectory: true)
        let url = folder.appendingPathComponent(AttachmentCache.safeFilename(attachment.info.filename))
        try AttachmentCache.write(data, to: url)
        return url
    }

    // MARK: Thread actions (each returns an undo token for `undo(_:)`)

    public func markRead(_ ids: [ThreadID], read: Bool) async throws -> String { try await core.threadActions.markRead(ids, read: read) }
    public func setPinned(_ ids: [ThreadID], pinned: Bool) async throws -> String { try await core.threadActions.setPinned(ids, pinned: pinned) }
    public func archive(_ ids: [ThreadID]) async throws -> String { try await core.threadActions.archive(ids) }
    public func trash(_ ids: [ThreadID]) async throws -> String { try await core.threadActions.trash(ids) }
    public func markSpam(_ ids: [ThreadID], spam: Bool) async throws -> String { try await core.threadActions.markSpam(ids, spam: spam) }
    public func moveToFolder(_ ids: [ThreadID], folderId: FolderID) async throws -> String {
        try await core.threadActions.moveToFolder(ids, folderId: folderId)
    }
    public func moveToInbox(_ ids: [ThreadID]) async throws -> String { try await core.threadActions.moveToInbox(ids) }
    public func snooze(_ ids: [ThreadID], until: EpochMs) async throws -> String { try await core.snooze(ids, until: until) }
    public func unsnooze(_ ids: [ThreadID]) async throws -> String { try await core.unsnooze(ids) }
    public func setMuted(_ ids: [ThreadID], muted: Bool) async throws -> String { try await core.setMuted(ids, muted: muted) }

    /// Files these threads under a category. With `rememberSender`, future mail from the same senders is filed there too.
    public func setCategory(_ ids: [ThreadID], _ category: MailCategory, rememberSender: Bool = false) async throws -> String {
        try await core.setCategory(ids, category, sender: rememberSender)
    }

    /// Undoes an action while its token is valid (30 seconds).
    public func undo(_ token: String) async throws { try await core.undo(token) }

    /// One-click unsubscribe, or a mailto from the message's account, or the link for the UI to open (`.browser`).
    public func unsubscribe(messageId: MessageRowID) async throws -> UnsubscribeMethod { try await core.unsubscribe(messageId) }

    // MARK: Blocked senders (their mail goes to the Blocked view, never the inbox)

    public func blockSender(_ pattern: String) async throws { try await core.blockSender(pattern) }
    public func unblockSender(_ pattern: String) async throws { try await core.unblockSender(pattern) }
    public func listBlocked() async throws -> [BlockedSender] { try await core.store.listBlocked() }
}

extension ServiceCore {
    func attachmentSession(_ attachmentId: Int) async throws -> AccountSession {
        guard let attachment = try await store.attachment(id: attachmentId),
              let message = try await store.message(id: attachment.messageRowId) else { throw FlintError(.notFound, "That attachment no longer exists.") }
        return sync.session(for: message.accountId)
    }
}
