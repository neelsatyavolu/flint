import FlintModel
import Foundation
import Testing
@testable import FlintMail

final class MailEventLog: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [FlintEvent] = []
    func add(_ event: FlintEvent) { lock.lock(); storage.append(event); lock.unlock() }
    var events: [FlintEvent] { lock.lock(); defer { lock.unlock() }; return storage }
    var toasts: [String] {
        events.compactMap { if case .toast(_, let message, _) = $0 { return message } else { return nil } }
    }
    var changes: [[ThreadID]] {
        events.compactMap { if case .mailChanged(_, let ids) = $0 { return ids } else { return nil } }
    }
}

private struct PipelineRig {
    let store: MailTestStore
    let fake: FakeMailTransport
    let log: MailEventLog
    let pipeline: OptimisticActions
    let inbox: Folder
    let archive: Folder
    let rowA: MessageRowID
    let rowB: MessageRowID

    static func make(now: @escaping @Sendable () -> EpochMs = { mailTestNow }, noSession: Bool = false) async throws -> PipelineRig {
        let store = MailTestStore()
        await store.addAccount(mailTestAccount())
        let fake = FakeMailTransport(folders: [RemoteFolder(path: "INBOX", delimiter: "/"), RemoteFolder(path: "Archive", delimiter: "/", attributes: ["archive"])])
        try await fake.connect(mailTestConfig)
        let inbox = try await store.upsertFolder("a1", FolderInput(path: "INBOX", role: .inbox))
        let archive = try await store.upsertFolder("a1", FolderInput(path: "Archive", role: .archive))
        let uidA = await fake.deliver(mailTestEnvelope("A", messageId: "<a@x>"), to: "INBOX")
        let uidB = await fake.deliver(mailTestEnvelope("B", messageId: "<b@x>"), to: "INBOX")
        func message(_ id: Int, thread: Int, uid: Int) -> StoredMessage {
            StoredMessage(id: id, accountId: "a1", threadId: thread, folderId: inbox.id, uid: uid, messageId: "<\(id)@x>", date: mailTestNow)
        }
        await store.addMessage(message(1, thread: 10, uid: uidA))
        await store.addMessage(message(2, thread: 20, uid: uidB))
        let log = MailEventLog()
        let runner = MailDirectRunner(fake)
        let actions = ServerActions(store: store, accountId: "a1", runner: runner)
        let pipeline = OptimisticActions(
            store: store, emit: { log.add($0) }, undo: UndoRegistry(now: { 0 }),
            actionsFor: { noSession ? nil : $0 == "a1" ? actions : nil }, now: now)
        return PipelineRig(store: store, fake: fake, log: log, pipeline: pipeline, inbox: inbox, archive: archive, rowA: 1, rowB: 2)
    }

    func loc(_ row: Int, thread: Int, uid: Int, seen: Bool = false) async -> MessageLocation {
        MessageLocation(
            messageRowId: row, threadId: thread, accountId: "a1", provider: .imap, folderId: inbox.id, folderPath: "INBOX", folderRole: .inbox, uid: uid,
            seen: seen, memberFolderIds: [inbox.id])
    }

    func result(thread: Int, row: Int, uid: Int, memberFolderIds: [FolderID]? = nil) async -> ActionResult {
        ActionResult(
            snapshot: ThreadSnapshot(threads: [ThreadSnapshot.Thread(
                id: thread, pinned: false, muted: false, snoozedUntil: nil, resurfacedAt: nil,
                messages: [ThreadSnapshot.Message(id: row, folderId: inbox.id, uid: uid, seen: false, flagged: false, answered: false, memberFolderIds: memberFolderIds ?? [inbox.id])])]),
            locations: [await loc(row, thread: thread, uid: uid)])
    }

    func flags(_ uid: Int) async -> Set<String> { await fake.envelopes(in: "INBOX").first { $0.uid == uid }?.flags ?? [] }
}

@Suite("Optimistic actions")
struct MailOptimisticTests {
    private func markReadSpec(_ r: PipelineRig, _ result: ActionResult, read: Bool = true) -> OptimisticSpec {
        OptimisticSpec(
            label: "mark as read", local: { result }, server: { actions, locs in await actions.setSeen(locs, read) },
            op: PendingOpSpec(kind: .seen, arg: .flag(read)), inverse: InverseOps.seen)
    }

    @Test func appliesLocallyThenOnTheServerAndEmitsMailChanged() async throws {
        let r = try await PipelineRig.make()
        let result = await r.result(thread: 10, row: 1, uid: 1)
        let token = try await r.pipeline.run(markReadSpec(r, result))
        #expect(!token.isEmpty)
        #expect(await r.flags(1) == [IMAPFlag.seen])
        #expect(r.log.changes == [[10]])
        #expect(r.log.toasts.isEmpty)
        #expect(await r.store.pendingOps.isEmpty) // recorded while running, gone afterwards
    }

    @Test func theOperationIsOnDiskWhileTheServerWorks() async throws {
        let r = try await PipelineRig.make()
        let result = await r.result(thread: 10, row: 1, uid: 1)
        let seenDuring = MailCounter()
        let store = r.store
        _ = try await r.pipeline.run(OptimisticSpec(
            label: "archive", local: { result },
            server: { actions, locs in
                await seenDuring.set(await store.pendingOps.count)
                return await actions.archive(locs)
            }, op: PendingOpSpec(kind: .archive)))
        #expect(await seenDuring.value == 1)
        #expect(await r.store.pendingOps.isEmpty)
    }

    @Test func aRefusedServerOperationRestoresOnlyTheFailedThreadsAndToasts() async throws {
        let r = try await PipelineRig.make()
        let a = await r.result(thread: 10, row: 1, uid: 1)
        let b = await r.result(thread: 20, row: 2, uid: 2)
        let both = ActionResult(snapshot: ThreadSnapshot(threads: a.snapshot.threads + b.snapshot.threads), locations: a.locations + b.locations)
        await r.fake.failNext("storeFlags", with: FlintError(.network, "dropped")) // INBOX group fails as a whole
        let token = try await r.pipeline.run(markReadSpec(r, both))
        let restored = await r.store.restoredSnapshots
        #expect(restored.count == 1 && Set(restored[0].threads.map(\.id)) == [10, 20])
        #expect(r.log.toasts == ["Couldn't mark as read. The change was undone."])
        #expect(await r.store.pendingOps.isEmpty)
        await #expect(throws: FlintError.self) { try await r.pipeline.undo(token) } // token discarded
    }

    @Test func aPartialFailureKeepsThreadsThatReachedTheServer() async throws {
        let r = try await PipelineRig.make()
        let folderB = try await r.store.upsertFolder("a1", FolderInput(path: "Projects"))
        _ = try await r.fake.createFolder("Projects")
        let uidP = await r.fake.deliver(mailTestEnvelope("P", messageId: "<p@x>"), to: "Projects")
        await r.store.addMessage(StoredMessage(id: 3, accountId: "a1", threadId: 30, folderId: folderB.id, uid: uidP, date: mailTestNow))
        let a = await r.result(thread: 10, row: 1, uid: 1)
        var p = await r.result(thread: 30, row: 3, uid: uidP)
        p.locations[0].folderId = folderB.id
        p.locations[0].folderPath = "Projects"
        let both = ActionResult(snapshot: ThreadSnapshot(threads: a.snapshot.threads + p.snapshot.threads), locations: a.locations + p.locations)
        await r.fake.failNext("storeFlags", with: FlintError(.network, "dropped")) // first group (INBOX) fails, Projects succeeds
        _ = try await r.pipeline.run(markReadSpec(r, both))
        let restored = await r.store.restoredSnapshots
        #expect(restored.count == 1 && restored[0].threads.map(\.id) == [10])
    }

    @Test func noSessionForTheAccountCountsAsAFailure() async throws {
        let r = try await PipelineRig.make(noSession: true)
        let result = await r.result(thread: 10, row: 1, uid: 1)
        _ = try await r.pipeline.run(markReadSpec(r, result))
        #expect(r.log.toasts.count == 1)
        #expect(await r.store.restoredSnapshots.count == 1)
    }

    @Test func localOnlyActionsSkipTheServer() async throws {
        let r = try await PipelineRig.make()
        let result = await r.result(thread: 10, row: 1, uid: 1)
        _ = try await r.pipeline.run(OptimisticSpec(label: "mute", local: { result }))
        let calls = await r.fake.calls
        #expect(!calls.contains("select") && r.log.changes == [[10]])
    }

    @Test func undoRestoresTheStoreAndRunsTheServerInverse() async throws {
        let r = try await PipelineRig.make()
        let result = await r.result(thread: 10, row: 1, uid: 1)
        let token = try await r.pipeline.run(markReadSpec(r, result))
        #expect(await r.flags(1) == [IMAPFlag.seen])
        try await r.pipeline.undo(token)
        #expect(await r.store.restoredSnapshots.count == 1)
        #expect(await r.flags(1).isEmpty) // location says seen == false, so the inverse clears \Seen
        await #expect(throws: FlintError.self) { try await r.pipeline.undo(token) } // single use
    }

    @Test func aFailedInverseToastsAndCorrectsOnTheNextSync() async throws {
        let r = try await PipelineRig.make()
        let result = await r.result(thread: 10, row: 1, uid: 1)
        let token = try await r.pipeline.run(markReadSpec(r, result))
        await r.fake.failNext("storeFlags", with: FlintError(.network, "dropped"))
        try await r.pipeline.undo(token)
        #expect(r.log.toasts == ["Couldn't undo mark as read on the server. It will correct itself on the next sync."])
    }

    @Test func undoOfAMoveSendsMessagesBackWhereTheSnapshotSaysTheyCameFrom() async throws {
        let r = try await PipelineRig.make()
        let result = await r.result(thread: 10, row: 1, uid: 1, memberFolderIds: [r.inbox.id])
        let token = try await r.pipeline.run(OptimisticSpec(
            label: "archive", local: { result }, server: { actions, locs in await actions.archive(locs) }, op: PendingOpSpec(kind: .archive),
            inverse: InverseOps.move(r.store)))
        #expect(await r.fake.envelopes(in: "Archive").count == 1)
        // After the local restore, the engine finds the message in Archive (relocated); undo moves it back to the inbox.
        let archived = try #require(try await r.store.messageLocations([1]).first)
        #expect(archived.folderId == r.archive.id)
        try await r.pipeline.undo(token)
        #expect(await r.fake.envelopes(in: "Archive").isEmpty)
        #expect(await r.fake.envelopes(in: "INBOX").count == 2)
    }

    // MARK: Replay

    @Test func replaysAnOperationTheAppWasKilledIn() async throws {
        let r = try await PipelineRig.make()
        _ = try await r.store.addPendingOp(accountId: "a1", PendingOpSpec(kind: .seen, arg: .flag(true)), messageIds: [1], now: mailTestNow)
        _ = try await r.store.addPendingOp(accountId: "a1", PendingOpSpec(kind: .moveFolder, arg: .folder(r.archive.id)), messageIds: [2], now: mailTestNow)
        #expect(await r.pipeline.replayPending() == 2)
        #expect(await r.flags(1) == [IMAPFlag.seen])
        #expect(await r.fake.envelopes(in: "Archive").count == 1)
        #expect(await r.store.pendingOps.isEmpty)
    }

    @Test func replayGivesUpAfterRepeatedFailuresOnVanishedMessagesAndOnStaleRecords() async throws {
        let r = try await PipelineRig.make()
        let id = try await r.store.addPendingOp(accountId: "a1", PendingOpSpec(kind: .seen, arg: .flag(true)), messageIds: [1], now: mailTestNow)
        for attempt in 1...2 {
            await r.fake.failNext("storeFlags", with: FlintError(.network, "dropped"))
            _ = await r.pipeline.replayPending()
            let pending = await r.store.pendingOps
            #expect(pending.first?.attempts == attempt)
            #expect(pending.first?.id == id)
        }
        await r.fake.failNext("storeFlags", with: FlintError(.network, "dropped"))
        _ = await r.pipeline.replayPending()
        #expect(await r.store.pendingOps.isEmpty)

        _ = try await r.store.addPendingOp(accountId: "a1", PendingOpSpec(kind: .archive), messageIds: [999_999], now: mailTestNow)
        _ = await r.pipeline.replayPending()
        #expect(await r.store.pendingOps.isEmpty)

        let old = try await PipelineRig.make(now: { mailTestNow + 2 * PendingOpReplay.maxAgeMs })
        _ = try await old.store.addPendingOp(accountId: "a1", PendingOpSpec(kind: .seen, arg: .flag(true)), messageIds: [1], now: mailTestNow)
        _ = await old.pipeline.replayPending()
        #expect(await old.store.pendingOps.isEmpty)
        #expect(await old.flags(1).isEmpty) // dropped without running
    }
}

actor MailCounter {
    private(set) var value = 0
    func set(_ newValue: Int) { value = newValue }
}

@Suite("UndoRegistry")
struct MailUndoRegistryTests {
    private func entry() -> UndoEntry { UndoEntry(label: "archive", snapshot: ThreadSnapshot(threads: []), affected: [1]) }

    @Test func tokensAreSingleUse() async throws {
        let registry = UndoRegistry(now: { 0 })
        let token = await registry.register(entry())
        #expect(try await registry.take(token).label == "archive")
        await #expect(throws: FlintError.self) { try await registry.take(token) }
    }

    @Test func tokensExpireAfterThirtySeconds() async throws {
        let clock = MailTestClock(1_000)
        let registry = UndoRegistry(now: { clock.now })
        let token = await registry.register(entry())
        clock.advance(29_999)
        #expect(await registry.count == 1)
        clock.advance(1)
        #expect(await registry.count == 0)
        await #expect(throws: FlintError.self) { try await registry.take(token) }
    }

    @Test func discardAndUnknownTokens() async throws {
        let registry = UndoRegistry(now: { 0 })
        let token = await registry.register(entry())
        await registry.discard(token)
        await #expect(throws: FlintError.self) { try await registry.take(token) }
        await #expect(throws: FlintError.self) { try await registry.take("nope") }
    }
}

@Suite("ThreadActions")
struct MailThreadActionsTests {
    @Test func markReadRunsLocalAndServerPartsAndRecordsTheUndoInverse() async throws {
        let r = try await PipelineRig.make()
        await r.store.script([await r.result(thread: 10, row: 1, uid: 1)])
        let actions = ThreadActions(store: r.store, pipeline: r.pipeline)
        let token = try await actions.markRead([10], read: true)
        let marked = await r.store.markedRead
        #expect(marked.first?.read == true)
        #expect(marked.first?.ids == [10])
        #expect(await r.flags(1) == [IMAPFlag.seen])
        try await actions.undo(token)
        #expect(await r.flags(1).isEmpty)
    }

    @Test func archiveTrashSpamAndMovesPassTheRightTargets() async throws {
        let r = try await PipelineRig.make()
        let actions = ThreadActions(store: r.store, pipeline: r.pipeline)
        _ = try await actions.archive([10])
        _ = try await actions.trash([10])
        _ = try await actions.markSpam([10], spam: true)
        _ = try await actions.markSpam([10], spam: false)
        _ = try await actions.moveToInbox([10])
        _ = try await actions.moveToFolder([10], folderId: r.archive.id)
        #expect(await r.store.movedTargets == [.archive, .trash, .spam, .inbox, .inbox, .folder(r.archive.id)])
    }

    @Test func trashAndSpamCreateTheirLocalFoldersFirst() async throws {
        let r = try await PipelineRig.make()
        let actions = ThreadActions(store: r.store, pipeline: r.pipeline)
        _ = try await actions.trash([10])
        _ = try await actions.markSpam([10], spam: true)
        let paths = try await r.store.listFolders(accountId: "a1").map(\.path)
        #expect(paths.contains("Trash") && paths.contains("Spam"))
    }

    @Test func invalidSelectionsAreRejected() async throws {
        let r = try await PipelineRig.make()
        let actions = ThreadActions(store: r.store, pipeline: r.pipeline)
        await #expect(throws: FlintError.self) { try await actions.archive([0]) }
        await #expect(throws: FlintError.self) { try await actions.archive(Array(1...5001)) }
    }

    @Test func pinUsesTheFlaggedFlag() async throws {
        let r = try await PipelineRig.make()
        await r.store.script([await r.result(thread: 10, row: 1, uid: 1)])
        _ = try await ThreadActions(store: r.store, pipeline: r.pipeline).setPinned([10], pinned: true)
        #expect(await r.flags(1) == [IMAPFlag.flagged])
    }
}
