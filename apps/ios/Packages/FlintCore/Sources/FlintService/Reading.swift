// Reading: thread lists with code badges, a thread's messages with bodies fetched on demand and sanitized for display,
// and the history/search calls that reach the server. Port of packages/core/src/service/reading.ts, messageView.ts and
// history.ts.

import FlintHTML
import FlintMail
import FlintModel
import FlintStore
import Foundation

extension ServiceCore {
    /// Inline (cid:) images are rewritten to `flint-attachment://<attachmentId>`; the reader's URL scheme handler serves them
    /// through `FlintService.attachmentData(_:)`.
    static let attachmentURLPrefix = "flint-attachment://"
    /// How long opening a thread waits for missing bodies before showing what it has.
    static let bodyWait: Duration = .milliseconds(1500)
    /// How long one body fetch may hold up the others; the fetch itself carries on.
    static let bodyFetchTimeout: Duration = .seconds(8)
    static let bodyParallelism = 4

    // MARK: Lists

    func listThreads(_ query: ThreadQuery) async throws -> ThreadPage {
        await syncUserFolderOnce(query)
        var page = try await store.listThreads(query, now: now())
        let badges = await codes.badges(threadIds: page.items.map(\.id))
        page.items = page.items.map { item in
            guard let badge = badges[item.id] else { return item }
            var copy = item
            copy.verificationCode = badge
            return copy
        }
        if page.nextCursor == nil { page.olderOnServer = await hasOlderOnServer(query) }
        return page
    }

    /// The first time a user folder is opened its mail is not local yet: pull it, then list.
    private func syncUserFolderOnce(_ query: ThreadQuery) async {
        guard query.view == .folder, let folderId = query.folderId,
              let folder = try? await store.folder(id: folderId), folder.role == nil,
              (try? await store.folderSyncState(folderId))?.lastSyncAt == nil, await firstOpen.insert(folderId) else { return }
        do { try await sync.session(for: folder.accountId).syncFolderNow(folderId) } catch { await firstOpen.remove(folderId) }
    }

    func sidebar() async throws -> SidebarData {
        var data = try await store.sidebarData(now: now())
        data.accounts = data.accounts.map { entry in
            var copy = entry
            copy.sync = sync.status(entry.account.id)
            return copy
        }
        return data
    }

    // MARK: Threads and messages

    func loadThread(_ id: ThreadID, wait: Duration? = ServiceCore.bodyWait) async throws -> ThreadRows {
        guard let first = try await store.threadRows(id) else { throw FlintError(.notFound, "That conversation no longer exists.") }
        let missing = first.messages.filter { !$0.bodyLoaded }
        if missing.isEmpty { return first }
        await ensureBodies(missing, wait: wait)
        return (try? await store.threadRows(id)) ?? first
    }

    /// Downloads the bodies of messages that only have headers. With a `wait` the call returns when it passes even if
    /// fetches are still running; failures (offline, message gone) are skipped and the caller shows what it has.
    func ensureBodies(_ messages: [StoredMessage], wait: Duration?) async {
        let todo = messages.filter { !$0.bodyLoaded }
        guard !todo.isEmpty else { return }
        let sync = self.sync
        let run: @Sendable () async -> Void = {
            await withTaskGroup(of: Void.self) { group in
                var queue = todo[...]
                func next() { if let m = queue.popFirst() { group.addTask { await Self.fetchOne(m, sync: sync) } } }
                for _ in 0..<min(Self.bodyParallelism, todo.count) { next() }
                while await group.next() != nil { next() }
            }
        }
        if let wait { _ = await Race.finishes(within: wait, run) } else { await run() }
    }

    private static func fetchOne(_ message: StoredMessage, sync: SyncManager) async {
        let session = sync.session(for: message.accountId)
        let id = message.id
        _ = await Race.finishes(within: bodyFetchTimeout) { try? await session.fetchBody(id) }
    }

    func threadDetail(_ id: ThreadID) async throws -> ThreadDetail {
        let rows = try await loadThread(id)
        let views = try await messageViews(rows)
        return ThreadDetail(
            id: rows.id, accountId: rows.accountId, subject: rows.subject, category: rows.category, pinned: rows.pinned, muted: rows.muted,
            snoozedUntil: rows.snoozedUntil, messages: views, draftIds: rows.draftIds, place: await threadPlace(rows))
    }

    /// Where the conversation is, from the folders each message is a member of (labels included for Gmail).
    private func threadPlace(_ rows: ThreadRows) async -> ThreadPlace? {
        guard let locations = try? await store.threadLocations([rows.id]), !locations.isEmpty,
              let folders = try? await store.listFolders(accountId: rows.accountId) else { return nil }
        let roles = Dictionary(folders.map { ($0.id, $0.role) }, uniquingKeysWith: { first, _ in first })
        return ThreadPlace.resolve(memberRoles: locations.map { location in location.memberFolderIds.map { roles[$0] ?? nil } })
    }

    func messageView(_ id: MessageRowID) async throws -> MessageView {
        guard let row = try await store.message(id: id) else { throw FlintError(.notFound, "That message no longer exists.") }
        let rows = try await loadThread(row.threadId)
        guard rows.messages.contains(where: { $0.id == id }) else { throw FlintError(.notFound, "That message no longer exists.") }
        guard let view = try await messageViews(rows).first(where: { $0.id == id }) else { throw FlintError(.notFound, "That message no longer exists.") }
        return view
    }

    func messageViews(_ rows: ThreadRows) async throws -> [MessageView] {
        let settings = try await store.settings()
        let policy = await imagePolicy(settings: settings, for: rows.messages)
        var out: [MessageView] = []
        for message in rows.messages { out.append(await view(of: message, settings: settings, policy: policy)) }
        return out
    }

    static func receiptsHost(_ endpoint: String) -> String? {
        let trimmed = endpoint.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }
        let withScheme = trimmed.range(of: #"^https?://"#, options: [.regularExpression, .caseInsensitive]) != nil ? trimmed : "https://\(trimmed)"
        return URLComponents(string: withScheme)?.host
    }

    private static func strippedCid(_ cid: String) -> String {
        cid.trimmingCharacters(in: CharacterSet(charactersIn: "<>")).lowercased()
    }

    /// The reader's MessageView: sanitized HTML with the image policy applied, trackers removed, receipt and code attached.
    private func view(of m: StoredMessage, settings: Settings, policy: ImagePolicy) async -> MessageView {
        let trust = SenderTrust(isFromMe: m.isFromMe, inSent: m.inSent, headers: m.headers)
        let allow = policy.allowed(messageId: m.id, from: m.from, trust: trust)
        let cids = Dictionary(m.attachments.compactMap { a in a.contentId.map { (Self.strippedCid($0), a.id) } }, uniquingKeysWith: { first, _ in first })
        var clean: SanitizeResult?
        if let raw = m.rawHtml {
            clean = HTMLSanitizer.sanitize(raw, SanitizeOptions(
                allowRemoteImages: allow, receiptsHost: Self.receiptsHost(settings.receipts.endpoint),
                cidResolver: { cid in cids[Self.strippedCid(cid)].map { "\(Self.attachmentURLPrefix)\($0)" } },
                blockTrackers: settings.inbox.blockTrackers))
        }
        var receipt: ReceiptDetail?
        if let messageId = m.messageId { receipt = try? await store.receiptDetail(accountId: m.accountId, messageId: messageId) }
        return MessageView(
            id: m.id, accountId: m.accountId, threadId: m.threadId, messageId: m.messageId, from: m.from, to: m.to, cc: m.cc, bcc: m.bcc,
            replyTo: m.replyTo, subject: m.subject, date: m.date, seen: m.seen, pinned: m.flagged, isFromMe: m.isFromMe, snippet: m.snippet,
            html: clean?.html, text: m.text, bodyLoaded: m.bodyLoaded,
            remoteImages: allow ? .allowed : .blocked, hasRemoteImages: clean?.hasRemoteImages ?? false, hasTrackers: clean?.hasTrackers ?? false,
            attachments: m.attachments, unsubscribe: m.unsubscribe, receipt: receipt, verificationCode: await codes.badge(messageId: m.id))
    }

    // MARK: Older mail and server search

    private static let viewRole: [ThreadListView: MailboxRole] = [
        .inbox: .inbox, .sent: .sent, .drafts: .drafts, .trash: .trash, .spam: .spam, .archive: .archive,
    ]

    /// The server folders whose history backs this list, grouped by account. Gmail reads All Mail (Trash and Spam for their views).
    func foldersForQuery(_ query: ThreadQuery) async -> [(account: Account, folders: [Folder])] {
        guard let accounts = try? await store.listAccounts() else { return [] }
        var out: [(Account, [Folder])] = []
        for account in accounts where account.enabled && (query.accountId == nil || query.accountId == account.id) {
            guard let all = try? await store.listFolders(accountId: account.id) else { continue }
            func byRole(_ role: MailboxRole) -> Folder? { all.first { $0.role == role } }
            let gmail = account.provider == .gmail && byRole(.all) != nil
            var folders: [Folder?]
            if query.view == .folder {
                guard let picked = all.first(where: { $0.id == query.folderId }) else { continue }
                folders = [gmail && picked.role == nil ? byRole(.all) : picked]
            } else if gmail {
                folders = [byRole(query.view == .trash ? .trash : query.view == .spam ? .spam : .all)]
            } else if let role = Self.viewRole[query.view] {
                folders = [byRole(role)]
            } else {
                folders = [byRole(.inbox), byRole(.sent), byRole(.archive)]
            }
            let picked = folders.compactMap { $0 }
            if !picked.isEmpty { out.append((account, picked)) }
        }
        return out
    }

    private func hasOlderOnServer(_ query: ThreadQuery) async -> Bool {
        for group in await foldersForQuery(query) {
            for folder in group.folders {
                guard let state = try? await store.folderSyncState(folder.id) else { continue }
                if state.uidNext != nil, let min = state.syncedMinUid, min > 1 { return true }
            }
        }
        return false
    }

    func loadOlder(_ query: ThreadQuery) async throws -> LoadOlderResult {
        let groups = await foldersForQuery(query)
        let sync = self.sync
        let parts = try await eachAccount(groups.map { group in
            { @Sendable in
                let result = try await sync.session(for: group.account.id).loadOlder(group.folders.map(\.id))
                return LoadOlderResult(loaded: result.loaded, hasMore: result.hasMore)
            }
        })
        return LoadOlderResult(loaded: parts.reduce(0) { $0 + $1.loaded }, hasMore: parts.contains { $0.hasMore })
    }

    /// Searches the mail servers for this query and stores matches that are not local yet; local search then finds them.
    func searchServer(_ search: String, accountId: AccountID?) async throws -> ServerSearchResult {
        guard search.count <= 500 else { throw FlintError(.invalid, "That search is too long.") }
        let request = RemoteSearch.request(for: search)
        guard !request.isEmpty else { return ServerSearchResult(found: 0, added: 0) }
        let query = ServerSearchQuery(request)
        let accounts = ((try? await store.listAccounts()) ?? []).filter { account in
            account.enabled && (accountId == nil || account.id == accountId)
                && (request.accounts.isEmpty || request.accounts.contains(account.email.lowercased()) || request.accounts.contains(account.id.lowercased()))
        }
        let sync = self.sync
        let (roles, names) = (request.roles, request.names)
        let parts = try await eachAccount(accounts.map { account in
            { @Sendable in
                let result = try await sync.session(for: account.id).searchServer(query, roles: roles, names: names)
                return ServerSearchResult(found: result.found, added: result.added)
            }
        })
        return ServerSearchResult(found: parts.reduce(0) { $0 + $1.found }, added: parts.reduce(0) { $0 + $1.added })
    }

    /// Runs one job per account; one account failing does not hide the others, every account failing throws.
    private func eachAccount<T: Sendable>(_ jobs: [@Sendable () async throws -> T]) async throws -> [T] {
        guard !jobs.isEmpty else { return [] }
        let results = await withTaskGroup(of: Result<T, Error>.self) { group in
            for job in jobs { group.addTask { do { return .success(try await job()) } catch { return .failure(error) } } }
            var all: [Result<T, Error>] = []
            for await result in group { all.append(result) }
            return all
        }
        let ok = results.compactMap { try? $0.get() }
        if ok.isEmpty, case .failure(let error)? = results.first {
            throw (error as? FlintError) ?? FlintError(.network, "Couldn't reach the mail server. Check your connection and try again.")
        }
        return ok
    }
}

extension ServerSearchQuery {
    init(_ request: RemoteSearchRequest) {
        func date(_ ms: EpochMs?) -> Date? { ms.map { Date(timeIntervalSince1970: Double($0) / 1000) } }
        self.init(
            from: request.from, to: request.to, cc: request.cc, subject: request.subject, text: request.text, seen: request.seen,
            flagged: request.flagged, since: date(request.sinceMs), before: date(request.beforeMs))
    }
}

/// What a server search found and what was new to this device.
public struct ServerSearchResult: Hashable, Sendable {
    public var found: Int
    public var added: Int

    public init(found: Int, added: Int) {
        self.found = found
        self.added = added
    }
}

/// The folders whose first open already triggered a sync, so it happens once per run.
actor FirstOpenSet {
    private var ids: Set<FolderID> = []
    func insert(_ id: FolderID) -> Bool { ids.insert(id).inserted }
    func remove(_ id: FolderID) { ids.remove(id) }
}
