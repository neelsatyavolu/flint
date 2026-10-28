import FlintModel
import Foundation
import Testing
@testable import FlintMail

private struct Rig {
    let store: MailTestStore
    let fake: FakeMailTransport
    let collector: SyncCollector
    let folder: Folder

    func context(gmail: Bool = false, initialDays: Int = 90, rolePaths: [MailboxRole: String] = [:]) -> FolderSyncContext {
        FolderSyncContext(
            store: store, accountId: "a1", transport: fake, gmail: gmail, now: { mailTestNow }, initialDays: initialDays, rolePaths: rolePaths,
            collector: collector)
    }
}

private func rig(
    capabilities: TransportCapabilities = TransportCapabilities(), folders: [RemoteFolder] = [RemoteFolder(path: "INBOX", delimiter: "/")],
    folderPath: String = "INBOX", role: MailboxRole? = .inbox
) async throws -> Rig {
    let store = MailTestStore()
    await store.addAccount(mailTestAccount())
    let fake = FakeMailTransport(capabilities: capabilities, folders: folders)
    try await fake.connect(mailTestConfig)
    let folder = try await store.upsertFolder("a1", FolderInput(path: folderPath, role: role))
    return Rig(store: store, fake: fake, collector: SyncCollector(), folder: folder)
}

private func deliver(_ rig: Rig, _ count: Int, ageDays: Double = 0, to path: String = "INBOX", subject: String = "m", flags: Set<String> = []) async {
    for i in 0..<count { await rig.fake.deliver(mailTestEnvelope("\(subject) \(i)", flags: flags, ageDays: ageDays), to: path) }
}

@Suite("FolderSync initial window")
struct MailInitialSyncTests {
    @Test func syncsTheWindowNewestFirstInBatchesOf200() async throws {
        let r = try await rig()
        await deliver(r, 5, ageDays: 400, subject: "old")
        await deliver(r, 450, ageDays: 1, subject: "recent")
        try await FolderSync.sync(r.context(), folder: r.folder)

        let rows = await r.store.allMessages(in: r.folder.id)
        #expect(rows.count == 450) // the five old ones are outside 90 days
        let drained = await r.collector.drain()
        #expect(drained.batches.map(\.items.count) == [200, 200, 50])
        #expect(drained.batches.allSatisfy { !$0.evaluated })
        // Newest first: the first batch holds the highest UIDs.
        #expect(drained.batches[0].items.map(\.uid).min() == 256 && drained.batches[2].items.map(\.uid).max() == 55)
        let state = try await r.store.folderSyncState(r.folder.id)
        #expect(state.uidValidity == 1000 && state.uidNext == 456 && state.syncedMinUid == 6 && state.lastSyncAt == mailTestNow)
    }

    @Test func zeroDaysMeansEverything() async throws {
        let r = try await rig()
        await deliver(r, 3, ageDays: 900)
        try await FolderSync.sync(r.context(initialDays: 0), folder: r.folder)
        #expect(await r.store.allMessages(in: r.folder.id).count == 3)
    }

    @Test func emptyMailboxStillRecordsTheStateSoTheNextSyncIsIncremental() async throws {
        let r = try await rig()
        try await FolderSync.sync(r.context(), folder: r.folder)
        let state = try await r.store.folderSyncState(r.folder.id)
        #expect(state.uidNext == 1 && state.syncedMinUid == 1 && state.uidValidity == 1000)
    }

    @Test func reportsProgress() async throws {
        let r = try await rig()
        await deliver(r, 250)
        let seen = MailProgressLog()
        let collector = SyncCollector(progress: { seen.add($0) })
        var context = r.context()
        context.collector = collector
        try await FolderSync.sync(context, folder: r.folder)
        let values = seen.values
        #expect(values.map(\.done) == [200, 250] && values.allSatisfy { $0.total == 250 && $0.folder == "INBOX" })
    }

    @Test func mapsEnvelopesIncludingHeadersAndAttachments() async throws {
        let r = try await rig()
        let tree = BodyPart(number: "", type: "multipart", subtype: "mixed", children: [
            BodyPart(number: "1", type: "text", subtype: "plain", parameters: ["charset": "utf-8"], encoding: "7bit"),
            BodyPart(number: "2", type: "application", subtype: "pdf", disposition: "attachment", filename: "a.pdf", size: 9),
        ])
        await r.fake.deliver(mailTestEnvelope("with file", structure: tree, headers: ["list-id": "<l.x>", "references": "<r1@x>", "x-unrequested": "no"]), to: "INBOX")
        try await FolderSync.sync(r.context(), folder: r.folder)
        let item = try #require(await r.collector.drain().batches.first?.items.first)
        #expect(item.hasAttachments && item.attachments.map(\.filename) == ["a.pdf"])
        #expect(item.headers == ["list-id": "<l.x>"] && item.references == ["r1@x"])
    }
}

final class MailProgressLog: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [SyncProgress] = []
    func add(_ value: SyncProgress) { lock.lock(); storage.append(value); lock.unlock() }
    var values: [SyncProgress] { lock.lock(); defer { lock.unlock() }; return storage }
}

@Suite("FolderSync incremental")
struct MailIncrementalSyncTests {
    @Test func newMailIsIngestedAndEvaluated() async throws {
        let r = try await rig()
        await deliver(r, 2)
        try await FolderSync.sync(r.context(), folder: r.folder)
        _ = await r.collector.drain()
        await deliver(r, 3, subject: "fresh")
        try await FolderSync.sync(r.context(), folder: r.folder)
        let drained = await r.collector.drain()
        #expect(drained.batches.count == 1 && drained.batches[0].evaluated)
        #expect(drained.batches[0].items.map(\.uid) == [3, 4, 5])
        #expect(await r.store.allMessages(in: r.folder.id).count == 5)
        #expect(try await r.store.folderSyncState(r.folder.id).uidNext == 6)
    }

    @Test func rangeQuirkNeverReingestsAnOlderMessage() async throws {
        // "5:*" returns UID 4 when nothing at or above 5 exists. uidNext moved because UID 5 arrived and was deleted.
        let r = try await rig()
        await deliver(r, 4)
        try await FolderSync.sync(r.context(), folder: r.folder)
        _ = await r.collector.drain()
        let ghost = await r.fake.deliver(mailTestEnvelope("ghost"), to: "INBOX")
        await r.fake.removeExternally(uids: [ghost], in: "INBOX")
        try await FolderSync.sync(r.context(), folder: r.folder)
        #expect(await r.collector.drain().batches.isEmpty)
        #expect(await r.store.allMessages(in: r.folder.id).count == 4)
    }

    @Test func flagChangesAreRefetchedForTheSyncedWindowWithoutCondstore() async throws {
        let r = try await rig()
        await deliver(r, 3)
        try await FolderSync.sync(r.context(), folder: r.folder)
        await r.fake.setFlagsExternally(uids: [2], flags: [IMAPFlag.seen, IMAPFlag.flagged], in: "INBOX")
        try await FolderSync.sync(r.context(), folder: r.folder)
        let row = try #require(await r.store.message(folderId: r.folder.id, uid: 2))
        #expect(row.seen && row.flagged)
        #expect(await r.fake.calls.contains("fetchFlags"))
        #expect(!(try #require(await r.store.message(folderId: r.folder.id, uid: 1))).seen)
    }

    @Test func condstoreFetchesOnlyChangedRowsAndSkipsWhenNothingChanged() async throws {
        let r = try await rig(capabilities: TransportCapabilities(condstore: true))
        await deliver(r, 3)
        try await FolderSync.sync(r.context(), folder: r.folder)
        let before = await r.fake.calls.filter { $0 == "fetchFlags" }.count
        try await FolderSync.sync(r.context(), folder: r.folder)
        #expect(await r.fake.calls.filter { $0 == "fetchFlags" }.count == before) // same modseq: no flag fetch at all

        await r.fake.setFlagsExternally(uids: [3], flags: [IMAPFlag.seen], in: "INBOX")
        try await FolderSync.sync(r.context(), folder: r.folder)
        #expect(await r.fake.calls.filter { $0 == "fetchFlags" }.count == before + 1)
        #expect(try #require(await r.store.message(folderId: r.folder.id, uid: 3)).seen)
        #expect(!(try #require(await r.store.message(folderId: r.folder.id, uid: 2))).seen)
        #expect(try await r.store.folderSyncState(r.folder.id).highestModseq != nil)
    }

    @Test func qresyncAppliesVanishedAndChangedFromSelect() async throws {
        let r = try await rig(capabilities: TransportCapabilities(condstore: true, qresync: true))
        await deliver(r, 4)
        try await FolderSync.sync(r.context(), folder: r.folder)
        await r.fake.removeExternally(uids: [2], in: "INBOX")
        await r.fake.setFlagsExternally(uids: [4], flags: [IMAPFlag.seen], in: "INBOX")
        let flagCalls = await r.fake.calls.filter { $0 == "fetchFlags" }.count
        try await FolderSync.sync(r.context(), folder: r.folder)
        #expect(try await r.store.message(folderId: r.folder.id, uid: 2) == nil)
        #expect(try #require(await r.store.message(folderId: r.folder.id, uid: 4)).seen)
        #expect(await r.fake.calls.filter { $0 == "fetchFlags" }.count == flagCalls) // no extra fetch
        #expect(await r.store.removedUids.contains { $0.uids == [2] })
    }

    @Test func uidValidityChangeDropsTheFolderAndStartsOver() async throws {
        let r = try await rig()
        await deliver(r, 3)
        try await FolderSync.sync(r.context(), folder: r.folder)
        _ = await r.collector.drain()
        await r.fake.setUIDValidity(2000, in: "INBOX")
        await deliver(r, 2, subject: "again")
        try await FolderSync.sync(r.context(), folder: r.folder)
        #expect(await r.store.resetFolders == [r.folder.id])
        let rows = await r.store.allMessages(in: r.folder.id)
        #expect(rows.map(\.uid) == [1, 2] && rows.allSatisfy { $0.subject.hasPrefix("again") })
        #expect(try await r.store.folderSyncState(r.folder.id).uidValidity == 2000)
        let drained = await r.collector.drain()
        #expect(drained.batches.allSatisfy { !$0.evaluated }) // a reset folder re-runs the initial window
    }

    @Test func reconcileRemovesMessagesGoneFromTheServer() async throws {
        let r = try await rig()
        await deliver(r, 5)
        try await FolderSync.sync(r.context(), folder: r.folder)
        await r.fake.removeExternally(uids: [2, 5], in: "INBOX")
        try await FolderSync.reconcileExpunges(r.context(), folder: r.folder)
        #expect(await r.store.allMessages(in: r.folder.id).map(\.uid) == [1, 3, 4])
    }

    @Test func reconcileIgnoresMessagesBelowTheSyncedWindow() async throws {
        let r = try await rig()
        await deliver(r, 3, ageDays: 400, subject: "old")
        await deliver(r, 3, ageDays: 1, subject: "recent")
        try await FolderSync.sync(r.context(), folder: r.folder)
        #expect(try await r.store.folderSyncState(r.folder.id).syncedMinUid == 4)
        try await FolderSync.reconcileExpunges(r.context(), folder: r.folder)
        #expect(await r.store.allMessages(in: r.folder.id).count == 3)
    }

    @Test func aSelectFailureSurfacesAndLeavesStateAlone() async throws {
        let r = try await rig()
        await r.fake.failNext("select", with: FlintError(.network, "boom"))
        await #expect(throws: FlintError.self) { try await FolderSync.sync(r.context(), folder: r.folder) }
        #expect(try await r.store.folderSyncState(r.folder.id).uidNext == nil)
    }
}

@Suite("FolderSync Gmail")
struct MailGmailFolderSyncTests {
    @Test func labelsBecomeFolderMembershipAndFlagRefetchCarriesThem() async throws {
        let r = try await rig(
            capabilities: TransportCapabilities(gmail: true),
            folders: [RemoteFolder(path: "[Gmail]/All Mail", delimiter: "/", attributes: ["all"]), RemoteFolder(path: "INBOX", delimiter: "/")],
            folderPath: "[Gmail]/All Mail", role: .all)
        let inbox = try await r.store.upsertFolder("a1", FolderInput(path: "INBOX", role: .inbox))
        let work = try await r.store.upsertFolder("a1", FolderInput(path: "Work"))
        let paths: [MailboxRole: String] = [.inbox: "INBOX"]
        await r.fake.deliver(mailTestEnvelope("g1", gmail: GmailAttributes(msgid: "m1", thrid: "t1", labels: ["\\Inbox", "Work"])), to: "[Gmail]/All Mail")
        try await FolderSync.sync(r.context(gmail: true, rolePaths: paths), folder: r.folder)

        let row = try #require(await r.store.message(folderId: r.folder.id, uid: 1))
        #expect(row.gmMsgid == "m1" && row.gmThrid == "t1")
        #expect(await r.store.membership(of: row.id) == [r.folder.id, inbox.id, work.id])

        // Archive elsewhere: the Inbox label disappears; the flag refetch brings the labels back.
        var changed = mailTestEnvelope("g1", gmail: GmailAttributes(msgid: "m1", thrid: "t1", labels: ["Work"]))
        changed.uid = 1
        await r.fake.replaceEnvelope(changed, in: "[Gmail]/All Mail")
        try await FolderSync.sync(r.context(gmail: true, rolePaths: paths), folder: r.folder)
        #expect(await r.store.membership(of: row.id) == [r.folder.id, work.id])
    }
}

@Suite("FolderSync history")
struct MailHistoryTests {
    @Test func backfillLoadsOlderMailInBatchesAndMarksTheFolderComplete() async throws {
        let r = try await rig()
        await deliver(r, 6, ageDays: 400, subject: "old")
        await deliver(r, 2, ageDays: 1, subject: "recent")
        try await FolderSync.sync(r.context(), folder: r.folder)
        #expect(try await r.store.folderSyncState(r.folder.id).syncedMinUid == 7)

        let first = try await FolderSync.backfill(r.context(), folder: r.folder, batch: 4)
        #expect(first == FolderSync.BackfillResult(loaded: 4, hasMore: true))
        #expect(try await r.store.folderSyncState(r.folder.id).syncedMinUid == 3)

        let second = try await FolderSync.backfill(r.context(), folder: r.folder, batch: 4)
        #expect(second == FolderSync.BackfillResult(loaded: 2, hasMore: false))
        #expect(try await r.store.folderSyncState(r.folder.id).syncedMinUid == 1)
        #expect(await r.store.allMessages(in: r.folder.id).count == 8)
        #expect(try await FolderSync.backfill(r.context(), folder: r.folder) == FolderSync.BackfillResult(loaded: 0, hasMore: false))
        let drained = await r.collector.drain()
        #expect(drained.batches.allSatisfy { !$0.evaluated })
    }

    @Test func serverSearchIngestsOnlyMissingMessagesNewestFirstAndCapped() async throws {
        let r = try await rig()
        await deliver(r, 3, ageDays: 1, subject: "recent")
        try await FolderSync.sync(r.context(), folder: r.folder)
        await deliver(r, 5, ageDays: 400, subject: "needle")
        let result = try await FolderSync.search(r.context(), folder: r.folder, criteria: .text("needle"), cap: 3)
        #expect(result.found == 5 && result.added == 3)
        #expect(await r.store.allMessages(in: r.folder.id).map(\.uid) == [1, 2, 3, 6, 7, 8]) // newest three matches
    }
}
