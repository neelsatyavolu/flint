import FlintModel
import Foundation
import Testing
@testable import FlintStore

private func thread() async throws -> (store: GRDBStore, s: StoreImapSeed, threadId: ThreadID) {
    let store = try StoreTestKit.makeStore()
    let s = try await StoreTestKit.seedImap(store)
    let out = try await store.ingestMessages(s.account.id, s.inbox.id, [
        StoreTestKit.msg(1) { $0.messageId = "a@x"; $0.subject = "Plan"; $0.date = StoreTestKit.t0 },
        StoreTestKit.msg(2) { $0.messageId = "b@x"; $0.references = ["a@x"]; $0.subject = "Re: Plan"; $0.date = StoreTestKit.t0 + 1000; $0.flags = StoreTestKit.seen },
    ], context: IngestContext())
    return (store, s, out[0].threadId)
}

private func inboxItems(_ store: GRDBStore, _ view: ThreadListView = .inbox, folderId: Int? = nil) async throws -> [ThreadListItem] {
    try await store.listThreads(ThreadQuery(view: view, folderId: folderId), now: StoreTestKit.t0 + StoreTestKit.day).items
}

@Suite("Store thread actions: flags")
struct StoreThreadFlagTests {
    @Test func marksEveryMessageReadAndReturnsTheChangedLocations() async throws {
        let (store, _, threadId) = try await thread()
        let r = try await store.markRead([threadId], read: true)
        #expect(r.locations.map(\.uid) == [1])
        #expect(try await inboxItems(store)[0].unreadCount == 0)
        #expect(try await store.markRead([threadId], read: true).locations == [])
        #expect(try await store.markRead([threadId], read: false).locations.map(\.uid).sorted() == [1, 2])
    }

    @Test func pinsByFlaggingAllMessagesAndReportsThemForImap() async throws {
        let (store, _, threadId) = try await thread()
        let r = try await store.setPinned([threadId], pinned: true)
        #expect(r.locations.count == 2 && r.locations.allSatisfy(\.flagged))
        #expect(try await store.threadRows(threadId)?.pinned == true)
        #expect(try await inboxItems(store, .pinned).count == 1)
        _ = try await store.setPinned([threadId], pinned: false)
        #expect(try await store.threadRows(threadId)?.pinned == false)
        #expect(try await inboxItems(store, .pinned) == [])
    }

    @Test func mutesAndSnoozesWithoutServerLocations() async throws {
        let (store, _, threadId) = try await thread()
        #expect(try await store.setMuted([threadId], muted: true).locations == [])
        #expect(try await store.threadRows(threadId)?.muted == true)
        _ = try await store.snooze([threadId], until: StoreTestKit.t0 + StoreTestKit.day)
        #expect(try await store.threadRows(threadId)?.snoozedUntil == StoreTestKit.t0 + StoreTestKit.day)
        _ = try await store.unsnooze([threadId])
        #expect(try await store.threadRows(threadId)?.snoozedUntil == nil)
    }

    @Test func wakeSnoozedMarksTheLatestMessageUnreadAndSetsResurfacedAt() async throws {
        let (store, _, threadId) = try await thread()
        _ = try await store.markRead([threadId], read: true)
        _ = try await store.snooze([threadId], until: StoreTestKit.t0 + StoreTestKit.day)
        let r = try await store.wakeSnoozed(threadId, now: StoreTestKit.t0 + 2 * StoreTestKit.day)
        #expect(r.locations.map(\.uid) == [2])
        let rows = try #require(try await store.threadRows(threadId))
        #expect(rows.snoozedUntil == nil && rows.resurfacedAt == StoreTestKit.t0 + 2 * StoreTestKit.day)
        #expect(rows.messages.map(\.seen) == [true, false])
        try await store.resurface(threadId, now: StoreTestKit.t0 + 3 * StoreTestKit.day)
        #expect(try await store.threadRows(threadId)?.resurfacedAt == StoreTestKit.t0 + 3 * StoreTestKit.day)
    }
}

@Suite("Store thread actions: snapshots")
struct StoreSnapshotTests {
    @Test func restoresFlagsThreadStateAndMembershipAfterChanges() async throws {
        let (store, s, threadId) = try await thread()
        let snap = try await store.snapshotThreads([threadId])
        // Round-trips through JSON like an undo token would.
        let revived = try JSONDecoder().decode(ThreadSnapshot.self, from: JSONEncoder().encode(snap))
        _ = try await store.markRead([threadId], read: true)
        _ = try await store.setPinned([threadId], pinned: true)
        _ = try await store.setMuted([threadId], muted: true)
        _ = try await store.snooze([threadId], until: StoreTestKit.t0 + StoreTestKit.day)
        _ = try await store.moveThreads([threadId], to: .trash)
        #expect(try await inboxItems(store, .trash).count == 1)
        #expect(try await store.restoreSnapshot(revived) == [threadId])
        let rows = try #require(try await store.threadRows(threadId))
        #expect(!rows.pinned && !rows.muted && rows.snoozedUntil == nil)
        #expect(rows.messages.map(\.seen) == [false, true])
        #expect(try await inboxItems(store, .trash) == [])
        #expect(try await inboxItems(store).count == 1)
        #expect(try await store.messageLocations([rows.messages[0].id])[0].memberFolderIds == [s.inbox.id])
    }

    @Test func ignoresThreadsThatNoLongerExist() async throws {
        let (store, _, _) = try await thread()
        let ghost = ThreadSnapshot(threads: [.init(id: 9999, pinned: true, muted: false, snoozedUntil: nil, resurfacedAt: nil, messages: [])])
        #expect(try await store.restoreSnapshot(ghost) == [])
    }

    @Test func undoingACategoryChangeRestoresBothCategoryAndSource() async throws {
        let (store, _, threadId) = try await thread()
        let snap = try await store.snapshotThreads([threadId])
        try await store.pinCategory([threadId], .newsletters, source: .manual)
        #expect(try await store.threadRows(threadId)?.category == .newsletters)
        _ = try await store.restoreSnapshot(snap)
        #expect(try await store.threadRows(threadId)?.category == .people)
        #expect(try await StoreTestKit.count(store, "SELECT COUNT(*) FROM messages WHERE category_source IS NOT NULL") == 0)
    }
}

@Suite("Store thread actions: moves")
struct StoreMoveTests {
    @Test func archiveTrashSpamInboxAndFolder() async throws {
        let (store, s, threadId) = try await thread()
        let proj = try await store.upsertFolder(s.account.id, FolderInput(path: "Projects"))
        func count(_ v: ThreadListView, _ folder: Int? = nil) async throws -> Int { try await inboxItems(store, v, folderId: folder).count }
        _ = try await store.moveThreads([threadId], to: .archive)
        #expect(try await [count(.inbox), count(.archive)] == [0, 1])
        _ = try await store.moveThreads([threadId], to: .trash)
        #expect(try await [count(.archive), count(.trash)] == [0, 1])
        _ = try await store.moveThreads([threadId], to: .spam)
        #expect(try await [count(.trash), count(.spam)] == [0, 1])
        _ = try await store.moveThreads([threadId], to: .inbox)
        #expect(try await [count(.spam), count(.inbox)] == [0, 1])
        _ = try await store.moveThreads([threadId], to: .folder(proj.id))
        #expect(try await [count(.inbox), count(.folder, proj.id)] == [0, 1])
    }

    @Test func archiveCreatesTheArchiveFolderWhenMissingAndKeepsSentMailInSent() async throws {
        let store = try StoreTestKit.makeStore()
        let a = try await store.createAccount(StoreTestKit.newAccount("x@x.com"))
        let inbox = try await store.upsertFolder(a.id, FolderInput(path: "INBOX", role: .inbox))
        let sent = try await store.upsertFolder(a.id, FolderInput(path: "Sent", role: .sent))
        let m1 = try await store.ingestMessages(a.id, inbox.id, [StoreTestKit.msg(1) { $0.messageId = "a@x" }], context: IngestContext())[0]
        _ = try await store.ingestMessages(a.id, sent.id, [StoreTestKit.msg(1) { $0.messageId = "b@x"; $0.references = ["a@x"]; $0.from = [Address(name: "X", address: "x@x.com")]; $0.to = [StoreTestKit.person("Bo")] }], context: IngestContext())
        let r = try await store.moveThreads([m1.threadId], to: .archive)
        #expect(r.locations.count == 1)
        #expect(try await store.folder(accountId: a.id, role: .archive) != nil)
        #expect(try await inboxItems(store, .sent).count == 1)
    }

    @Test func throwsAFriendlyErrorWhenTheTrashFolderIsMissing() async throws {
        let store = try StoreTestKit.makeStore()
        let a = try await store.createAccount(StoreTestKit.newAccount("x@x.com"))
        let inbox = try await store.upsertFolder(a.id, FolderInput(path: "INBOX", role: .inbox))
        let o = try await store.ingestMessages(a.id, inbox.id, [StoreTestKit.msg(1)], context: IngestContext())[0]
        await expectStoreError(.notFound) { _ = try await store.moveThreads([o.threadId], to: .trash) }
        #expect(try await inboxItems(store).count == 1)
    }

    @Test func relocateMessageRecordsTheServersNewUid() async throws {
        let (store, s, threadId) = try await thread()
        let first = try #require(try await store.threadLocations([threadId]).first)
        try await store.relocateMessage(first.messageRowId, folderId: s.archive.id, uid: 42)
        #expect(try await store.message(folderId: s.archive.id, uid: 42)?.id == first.messageRowId)
        #expect(try await store.listLocalUids(s.inbox.id, minUid: 0) == [2])
    }

    @Test func gmailTrashReplacesMembershipInboxRestoresItAndFolderAddsALabel() async throws {
        let store = try StoreTestKit.makeStore()
        let g = try await StoreTestKit.seedGmail(store)
        let o = try await store.ingestMessages(g.account.id, g.all.id, [
            StoreTestKit.msg(1) { $0.gmMsgid = "1"; $0.gmThrid = "T"; $0.gmLabels = ["INBOX"] },
            StoreTestKit.msg(2) { $0.gmMsgid = "2"; $0.gmThrid = "T"; $0.from = [StoreTestKit.me()]; $0.to = [StoreTestKit.person("Bo")]; $0.gmLabels = ["[Gmail]/Sent Mail"] },
        ], context: IngestContext())[0]
        let label = try await store.upsertFolder(g.account.id, FolderInput(path: "Receipts"))
        func members() async throws -> [[Int]] { try await store.threadLocations([o.threadId]).map { $0.memberFolderIds.sorted() } }
        _ = try await store.moveThreads([o.threadId], to: .folder(label.id))
        #expect(try await members() == [[g.all.id, label.id].sorted(), [g.all.id, g.sent.id].sorted()])
        _ = try await store.moveThreads([o.threadId], to: .trash)
        #expect(try await members() == [[g.trash.id], [g.trash.id]])
        _ = try await store.moveThreads([o.threadId], to: .inbox)
        #expect(try await members()[0] == [g.all.id, g.inbox.id].sorted())
        #expect(try await inboxItems(store).count == 1)
        _ = try await store.moveThreads([o.threadId], to: .spam)
        #expect(try await inboxItems(store, .spam).count == 1)
    }
}
