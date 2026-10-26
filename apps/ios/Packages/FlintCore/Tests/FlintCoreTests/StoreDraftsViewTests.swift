import FlintModel
import Foundation
import Testing
@testable import FlintStore

@Suite("Store queued sends and the Drafts view")
struct StoreDraftsViewTests {
    private func serverDraft(_ store: GRDBStore, _ s: StoreImapSeed, _ uid: Int, _ configure: (inout IngestMessage) -> Void = { _ in }) async throws {
        _ = try await store.ingestMessages(s.account.id, s.drafts.id, [StoreTestKit.msg(uid) {
            $0.from = [StoreTestKit.me()]; $0.to = [StoreTestKit.person("Bob")]; $0.subject = "Server \(uid)"; $0.flags = StoreTestKit.draftFlags
            configure(&$0)
        }], context: IngestContext())
    }

    @Test func queuedSendsAreNotDraftsWhileQueuedAndComeBackWhenCancelled() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        _ = try await store.ingestMessages(s.account.id, s.inbox.id, [StoreTestKit.msg(50) { $0.from = [StoreTestKit.person("Dana")]; $0.to = [StoreTestKit.me()]; $0.subject = "Hello" }], context: IngestContext())
        let now = StoreTestKit.t0 + StoreTestKit.day
        let threadId = try #require(try await store.listThreads(ThreadQuery(view: .inbox), now: now).items.first?.id)
        let d = try await store.createDraft(NewDraft(accountId: s.account.id, from: "me@example.com", threadId: threadId, to: [StoreTestKit.person("Dana")], subject: "Re: Hello"), now: StoreTestKit.t0)
        #expect(try await store.threadRows(threadId)?.draftIds == [d.id])
        #expect(try await store.listThreads(ThreadQuery(view: .inbox), now: now).items[0].hasDraft)
        let row = try await store.createScheduledSend(NewScheduledSend(draftId: d.id, sendAt: StoreTestKit.t0 + 10_000), now: StoreTestKit.t0)
        #expect(try await store.threadRows(threadId)?.draftIds == [])
        #expect(try await !store.listThreads(ThreadQuery(view: .inbox), now: now).items[0].hasDraft)
        #expect(try await store.listThreads(ThreadQuery(view: .drafts), now: now).items.count == 0)
        _ = try await store.updateScheduled(row.id, ScheduledSendPatch(status: .cancelled))
        #expect(try await store.threadRows(threadId)?.draftIds == [d.id])
        #expect(try await store.listThreads(ThreadQuery(view: .drafts), now: now).items.count == 1)
    }

    @Test func listsLocalDraftsThatWereNeverSyncedNewestFirstWithTheDraftFields() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        _ = try await store.createDraft(NewDraft(accountId: s.account.id, from: "me@example.com"), now: StoreTestKit.t0)
        _ = try await store.createDraft(NewDraft(accountId: s.account.id, from: "me@example.com", to: [StoreTestKit.person("Bob")], subject: "Plan", html: "<p>Here is <b>the</b> plan</p>"), now: StoreTestKit.t0 + 5000)
        let page = try await store.listThreads(ThreadQuery(view: .drafts), now: StoreTestKit.t0 + StoreTestKit.day)
        #expect(page.items.map(\.subject) == ["Plan", "(No subject)"])
        let first = page.items[0]
        #expect(first.accountId == s.account.id && first.snippet == "Here is the plan" && first.hasDraft && first.lastDate == StoreTestKit.t0 + 5000 && first.unreadCount == 0)
        #expect(first.draft?.messageId == nil)
        #expect(first.participants.map(\.address) == ["bob@example.org"])
        #expect(first.id < 0)
        #expect(first.draft?.draftId == -first.id)
    }

    @Test func mergesServerDraftsAndShowsEachOnceWithAndWithoutALocalDraftBehindIt() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        try await serverDraft(store, s, 1) { $0.messageId = "linked@x"; $0.subject = "Linked" }
        try await serverDraft(store, s, 2) { $0.messageId = "elsewhere@x"; $0.subject = "From Gmail web"; $0.date = StoreTestKit.t0 + 9000 }
        let linked = try await store.createDraft(NewDraft(accountId: s.account.id, from: "me@example.com", subject: "Linked"), now: StoreTestKit.t0 + 100)
        try await store.setDraftMeta(linked.id, DraftMeta(serverUid: 1, serverMessageId: "linked@x"))
        let items = try await store.listThreads(ThreadQuery(view: .drafts), now: StoreTestKit.t0 + StoreTestKit.day).items
        #expect(items.map(\.subject) == ["From Gmail web", "Linked"])
        #expect(items[0].draft?.messageId != nil && items[0].draft?.draftId == nil)
        #expect(items[0].participants.map(\.address) == ["bob@example.org"])
        #expect(items[1].draft?.draftId == linked.id)
        #expect(try await store.sidebarData(now: StoreTestKit.t0 + StoreTestKit.day).counts.drafts == items.count)
    }

    @Test func matchesTheServerCopyByUidInTheDraftsFolderWhenNoMessageIDIsStored() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        try await serverDraft(store, s, 7) { $0.messageId = "legacy@x"; $0.subject = "Legacy" }
        let d = try await store.createDraft(NewDraft(accountId: s.account.id, from: "me@example.com", subject: "Legacy"), now: StoreTestKit.t0)
        try await store.setDraftMeta(d.id, DraftMeta(serverUid: 7))
        #expect(try await store.listThreads(ThreadQuery(view: .drafts), now: StoreTestKit.t0 + StoreTestKit.day).items.count == 1)
        #expect(try await store.findDraft(accountId: s.account.id, serverMessageId: "legacy@x", folderId: s.drafts.id, uid: 7)?.id == d.id)
        #expect(try await store.findDraft(accountId: s.account.id, serverMessageId: nil, folderId: s.inbox.id, uid: 7) == nil)
    }

    @Test func matchesAGmailCopyByMessageIDEvenThoughItsUidDiffers() async throws {
        let store = try StoreTestKit.makeStore()
        let g = try await StoreTestKit.seedGmail(store)
        _ = try await store.ingestMessages(g.account.id, g.all.id, [StoreTestKit.msg(400) { $0.messageId = "gm@x"; $0.from = [StoreTestKit.me()]; $0.subject = "Gmail copy"; $0.flags = StoreTestKit.draftFlags }], context: IngestContext())
        _ = try await store.applyGmailLabels(g.all.id, [(uid: 400, labels: ["[Gmail]/Drafts"])])
        let d = try await store.createDraft(NewDraft(accountId: g.account.id, from: "me@gmail.com", subject: "Gmail copy"), now: StoreTestKit.t0)
        try await store.setDraftMeta(d.id, DraftMeta(serverUid: 3, serverMessageId: "gm@x"))
        let items = try await store.listThreads(ThreadQuery(view: .drafts), now: StoreTestKit.t0 + StoreTestKit.day).items
        #expect(items.count == 1 && items[0].draft?.draftId == d.id)
    }

    @Test func filtersByAccountPagesWithACursorAndKeepsTheSidebarCountEqualToTheList() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        let other = try await StoreTestKit.seedImap(store, "other@example.com")
        for i in 0..<5 { _ = try await store.createDraft(NewDraft(accountId: s.account.id, from: "me@example.com", subject: "L\(i)"), now: StoreTestKit.t0 + i * 1000) }
        _ = try await store.createDraft(NewDraft(accountId: other.account.id, from: "other@example.com", subject: "Other"), now: StoreTestKit.t0 + 50_000)
        try await serverDraft(store, s, 1) { $0.subject = "S1"; $0.date = StoreTestKit.t0 + 2500 }
        let now = StoreTestKit.t0 + StoreTestKit.day
        let all = try await store.listThreads(ThreadQuery(view: .drafts), now: now).items
        #expect(all.count == 7)
        #expect(try await store.sidebarData(now: now).counts.drafts == 7)
        #expect(try await store.listThreads(ThreadQuery(view: .drafts, accountId: other.account.id), now: now).items.map(\.subject) == ["Other"])
        var seen: [String] = []
        var cursor: String?
        for _ in 0..<10 {
            let page = try await store.listThreads(ThreadQuery(view: .drafts, cursor: cursor, limit: 3), now: now)
            seen += page.items.map(\.subject)
            guard let next = page.nextCursor else { break }
            cursor = next
        }
        #expect(seen == all.map(\.subject))
        #expect(try await store.listThreads(ThreadQuery(view: .drafts, sort: .oldest), now: now).items.first?.subject == "L0")
        #expect(try await store.listThreads(ThreadQuery(view: .drafts, unreadOnly: true), now: now).items == [])
    }
}
