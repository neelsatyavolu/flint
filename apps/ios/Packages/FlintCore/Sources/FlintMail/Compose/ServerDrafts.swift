// Keeps a copy of each draft in the server's Drafts folder so other clients see it. The copy is replaced at most every
// 10 seconds while a draft is being edited. Port of packages/core/src/service/compose-server-drafts.ts.

import FlintModel
import FlintStore
import Foundation

public typealias ServerDraftsStore = MailEngineStore & DraftsRepository

public actor ServerDrafts {
    /// The server Drafts copy is replaced at most this often while a draft is being edited.
    public static let defaultDelay: Duration = .seconds(10)

    private let store: any ServerDraftsStore
    private let runner: @Sendable (AccountID) -> (any TransportRunner)?
    private let emit: @Sendable (FlintEvent) -> Void
    private let now: @Sendable () -> Date
    private let delay: Duration
    private var timers: [Int: Task<Void, Never>] = [:]
    private var running: [Int: Task<Void, Never>] = [:]

    public init(
        store: any ServerDraftsStore, runner: @escaping @Sendable (AccountID) -> (any TransportRunner)?, emit: @escaping @Sendable (FlintEvent) -> Void,
        delay: Duration = ServerDrafts.defaultDelay, now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.store = store
        self.runner = runner
        self.emit = emit
        self.delay = delay
        self.now = now
    }

    private static func isBlank(_ d: Draft) -> Bool {
        d.to.count + d.cc.count + d.bcc.count + d.attachments.count == 0 && d.subject.trimmingCharacters(in: .whitespaces).isEmpty
            && PlainText.fromHTML(d.html).isEmpty
    }

    /// Marks the draft as edited; its server copy is refreshed once the delay passes.
    public func touch(_ draftId: Int) {
        guard timers[draftId] == nil else { return }
        timers[draftId] = Task { [delay] in
            try? await Task.sleep(for: delay)
            if Task.isCancelled { return }
            await self.timerFired(draftId)
        }
    }

    private func timerFired(_ draftId: Int) async {
        timers[draftId] = nil
        let previous = running[draftId]
        await previous?.value
        await start(draftId).value
    }

    /// Uploads now (tests, shutdown).
    public func flush(_ draftId: Int) async {
        timers.removeValue(forKey: draftId)?.cancel()
        await running[draftId]?.value
        await start(draftId).value
    }

    /// Waits for a running upload, cancels a pending one and removes the server copy. Call before deleting the local row.
    public func remove(_ draftId: Int) async {
        timers.removeValue(forKey: draftId)?.cancel()
        await running[draftId]?.value
        guard let draft = try? await store.draft(id: draftId), let meta = try? await store.draftMeta(draftId), let uid = meta.serverUid else { return }
        guard let folder = try? await store.folder(accountId: draft.accountId, role: .drafts), let runner = runner(draft.accountId) else { return }
        try? await Mailer.deleteDraft(runner: runner, draftsPath: folder.path, uid: uid)
    }

    private func start(_ draftId: Int) -> Task<Void, Never> {
        let job = Task { await self.upload(draftId) }
        running[draftId] = job
        return job
    }

    /// The replaced copy is gone from the server; drop the local mirror of it now so the Drafts view never lists both until the next sync.
    private func dropReplacedCopy(accountId: AccountID, folderId: FolderID, previous: DraftMeta, newUid: Int?) async {
        var stale: [StoredMessage] = []
        if let id = previous.serverMessageId { stale += (try? await store.messages(accountId: accountId, messageId: id)) ?? [] }
        if let uid = previous.serverUid, let message = try? await store.message(folderId: folderId, uid: uid) { stale.append(message) }
        stale = stale.filter { $0.draft && !($0.folderId == folderId && $0.uid == newUid) }
        var threads: [ThreadID] = []
        for folder in Set(stale.map(\.folderId)) {
            let uids = stale.filter { $0.folderId == folder }.map(\.uid)
            threads += (try? await store.removeUids(folder, uids)) ?? []
        }
        if !threads.isEmpty { emit(.mailChanged(accountId: accountId, threadIds: Array(Set(threads)).sorted())) }
    }

    private func upload(_ draftId: Int) async {
        defer { running[draftId] = nil }
        guard let draft = try? await store.draft(id: draftId), !Self.isBlank(draft) else { return }
        guard let account = try? await store.account(id: draft.accountId), let runner = runner(account.id) else { return }
        do {
            let folder = try await store.ensureFolder(accountId: account.id, role: .drafts)
            let meta = try await store.draftMeta(draftId)
            var input = DraftMime.input(draft: draft, meta: meta, account: account, plainTextOnly: false)
            let messageId = MimeBuilder.newMessageId(fromAddress: draft.from)
            input.messageId = messageId
            input.keepBcc = true
            let mime = try MimeBuilder.build(input, now: now())
            let uid = try await Mailer.replaceDraft(runner: runner, draftsPath: folder.path, previousUid: meta.serverUid, mime: mime)
            if (try? await store.draft(id: draftId)) != nil {
                var next = meta
                next.serverUid = uid
                next.serverMessageId = messageId
                try await store.setDraftMeta(draftId, next)
                await dropReplacedCopy(accountId: account.id, folderId: folder.id, previous: meta, newUid: uid)
            } else if let uid {
                try? await Mailer.deleteDraft(runner: runner, draftsPath: folder.path, uid: uid)
            }
        } catch {
            return // the local draft is the source of truth; the next edit retries
        }
    }
}
