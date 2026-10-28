import FlintModel
import Foundation
import Testing
@testable import FlintStore

private struct Fixture {
    var store: GRDBStore
    var s: StoreImapSeed

    init() async throws {
        store = try StoreTestKit.makeStore()
        s = try await StoreTestKit.seedImap(store)
    }

    @discardableResult
    func ing(_ folder: Folder, _ items: IngestMessage...) async throws -> [IngestOutcome] {
        try await store.ingestMessages(s.account.id, folder.id, items, context: IngestContext())
    }

    func page(_ query: ThreadQuery, now: Int = StoreTestKit.t0 + StoreTestKit.day) async throws -> ThreadPage { try await store.listThreads(query, now: now) }
    func subjects(_ query: ThreadQuery, now: Int = StoreTestKit.t0 + StoreTestKit.day) async throws -> [String] { try await page(query, now: now).items.map(\.subject) }
}

@Suite("Store thread list: inbox")
struct StoreThreadListInboxTests {
    @Test func returnsThreadListItemFields() async throws {
        let f = try await Fixture()
        try await f.ing(
            f.s.inbox,
            StoreTestKit.msg(1) { $0.messageId = "a@x"; $0.subject = "Plan"; $0.date = StoreTestKit.t0; $0.snippet = "first"; $0.hasAttachments = true },
            StoreTestKit.msg(2) {
                $0.messageId = "b@x"; $0.inReplyTo = "a@x"; $0.references = ["a@x"]; $0.subject = "Re: Plan"; $0.from = [StoreTestKit.me()]; $0.to = [StoreTestKit.person("Carla")]
                $0.date = StoreTestKit.t0 + 1000; $0.snippet = "my reply"; $0.flags = StoreTestKit.seen
            },
            StoreTestKit.msg(3) {
                $0.messageId = "c@x"; $0.inReplyTo = "b@x"; $0.references = ["a@x", "b@x"]; $0.subject = "Re: Plan"; $0.from = [StoreTestKit.person("Dan")]
                $0.date = StoreTestKit.t0 + 2000; $0.snippet = "latest"
            })
        let page = try await f.page(ThreadQuery(view: .inbox))
        #expect(page.nextCursor == nil && page.bundles == [] && page.items.count == 1)
        let item = page.items[0]
        #expect(item.accountId == f.s.account.id && item.subject == "Plan" && item.snippet == "latest" && item.messageCount == 3 && item.unreadCount == 2)
        #expect(item.hasAttachments && !item.pinned && !item.muted && item.snoozedUntil == nil && item.category == .people && !item.hasDraft)
        #expect(item.receipt == nil && item.lastDate == StoreTestKit.t0 + 2000 && item.draft == nil)
        #expect(item.participants.map(\.name) == ["Carla", "me", "Dan"])
    }

    @Test func movesARepeatedSenderToTheEndOfParticipants() async throws {
        let f = try await Fixture()
        try await f.ing(
            f.s.inbox,
            StoreTestKit.msg(1) { $0.messageId = "a@x"; $0.from = [StoreTestKit.person("Carla")]; $0.date = StoreTestKit.t0 },
            StoreTestKit.msg(2) { $0.messageId = "b@x"; $0.references = ["a@x"]; $0.from = [StoreTestKit.person("Dan")]; $0.date = StoreTestKit.t0 + 1 },
            StoreTestKit.msg(3) { $0.messageId = "c@x"; $0.references = ["a@x"]; $0.from = [StoreTestKit.person("Carla")]; $0.date = StoreTestKit.t0 + 2 })
        #expect(try await f.page(ThreadQuery(view: .inbox)).items[0].participants.map(\.name) == ["Dan", "Carla"])
    }

    @Test func hidesSnoozedThreadsUntilTheyWakeThenSortsByResurfacedAt() async throws {
        let f = try await Fixture()
        let out = try await f.ing(f.s.inbox, StoreTestKit.msg(1) { $0.subject = "old"; $0.from = [StoreTestKit.person("Al")]; $0.date = StoreTestKit.t0 }, StoreTestKit.msg(2) { $0.subject = "new"; $0.from = [StoreTestKit.person("Bo")]; $0.date = StoreTestKit.t0 + StoreTestKit.day })
        let (a, b) = (out[0], out[1])
        _ = try await f.store.snooze([a.threadId], until: StoreTestKit.t0 + 5 * StoreTestKit.day)
        func ids(_ view: ThreadListView, _ days: Int) async throws -> [Int] { try await f.page(ThreadQuery(view: view), now: StoreTestKit.t0 + days * StoreTestKit.day).items.map(\.id) }
        #expect(try await ids(.inbox, 2) == [b.threadId])
        #expect(try await ids(.snoozed, 2) == [a.threadId])
        #expect(try await ids(.inbox, 6) == [b.threadId, a.threadId])
        #expect(try await f.store.listDueSnoozes(now: StoreTestKit.t0 + 6 * StoreTestKit.day) == [a.threadId])
        let woke = try await f.store.wakeSnoozed(a.threadId, now: StoreTestKit.t0 + 6 * StoreTestKit.day)
        #expect(woke.locations == []) // already unread
        let items = try await f.page(ThreadQuery(view: .inbox), now: StoreTestKit.t0 + 7 * StoreTestKit.day).items
        #expect(items.map(\.id) == [a.threadId, b.threadId])
        #expect(items[0].lastDate == StoreTestKit.t0 + 6 * StoreTestKit.day)
        #expect(try await ids(.snoozed, 7) == [])
    }

    @Test func filtersToThreadsWithAttachmentsOnTopOfTheViewSoSnoozedMailStaysOut() async throws {
        let f = try await Fixture()
        let out = try await f.ing(
            f.s.inbox,
            StoreTestKit.msg(1) { $0.subject = "pdf"; $0.from = [StoreTestKit.person("Al")]; $0.date = StoreTestKit.t0; $0.hasAttachments = true },
            StoreTestKit.msg(2) { $0.subject = "plain"; $0.from = [StoreTestKit.person("Bo")]; $0.date = StoreTestKit.t0 + 1 },
            StoreTestKit.msg(3) { $0.subject = "snoozed pdf"; $0.from = [StoreTestKit.person("Cy")]; $0.date = StoreTestKit.t0 + 2; $0.hasAttachments = true })
        _ = try await f.store.snooze([out[2].threadId], until: StoreTestKit.t0 + 5 * StoreTestKit.day)
        #expect(try await f.page(ThreadQuery(view: .inbox, hasAttachments: true)).items.map(\.id) == [out[0].threadId])
    }

    @Test func filtersByAccountAndUnified() async throws {
        let store = try StoreTestKit.makeStore()
        let a = try await StoreTestKit.seedImap(store, "a@example.com")
        let b = try await StoreTestKit.seedImap(store, "b@example.com")
        _ = try await store.ingestMessages(a.account.id, a.inbox.id, [StoreTestKit.msg(1) { $0.subject = "for a" }], context: IngestContext())
        _ = try await store.ingestMessages(b.account.id, b.inbox.id, [StoreTestKit.msg(1) { $0.subject = "for b" }], context: IngestContext())
        #expect(try await store.listThreads(ThreadQuery(view: .inbox), now: StoreTestKit.t0 + StoreTestKit.day).items.count == 2)
        #expect(try await store.listThreads(ThreadQuery(view: .inbox, accountId: b.account.id), now: StoreTestKit.t0 + StoreTestKit.day).items.map(\.subject) == ["for b"])
    }

    @Test func filtersUnreadOnlyAndSortsOldestFirst() async throws {
        let f = try await Fixture()
        try await f.ing(
            f.s.inbox,
            StoreTestKit.msg(1) { $0.subject = "read"; $0.date = StoreTestKit.t0; $0.flags = StoreTestKit.seen; $0.from = [StoreTestKit.person("A")] },
            StoreTestKit.msg(2) { $0.subject = "unread"; $0.date = StoreTestKit.t0 + 1; $0.from = [StoreTestKit.person("B")] },
            StoreTestKit.msg(3) { $0.subject = "newest unread"; $0.date = StoreTestKit.t0 + 2; $0.from = [StoreTestKit.person("C")] })
        #expect(try await f.subjects(ThreadQuery(view: .inbox, unreadOnly: true)) == ["newest unread", "unread"])
        #expect(try await f.subjects(ThreadQuery(view: .inbox, sort: .oldest)) == ["read", "unread", "newest unread"])
    }

    @Test func paginatesWithKeysetCursorsIncludingEqualSortKeys() async throws {
        let f = try await Fixture()
        let items = (0..<25).map { i in StoreTestKit.msg(i + 1) { $0.subject = "t\(i)"; $0.from = [StoreTestKit.person("P\(i)")]; $0.date = StoreTestKit.t0 + (i / 5) * 1000 } }
        _ = try await f.store.ingestMessages(f.s.account.id, f.s.inbox.id, items, context: IngestContext())
        for sort in [SortOrder.newest, .oldest] {
            var seen: [Int] = []
            var cursor: String?
            for _ in 0..<10 {
                let page = try await f.page(ThreadQuery(view: .inbox, sort: sort, cursor: cursor, limit: 7))
                seen += page.items.map(\.id)
                guard let next = page.nextCursor else { break }
                cursor = next
            }
            #expect(seen.count == 25 && Set(seen).count == 25)
        }
        #expect(try await f.page(ThreadQuery(view: .inbox, limit: 500)).items.count == 25)
        #expect(try await f.page(ThreadQuery(view: .inbox, limit: 0)).items.count == 1)
        await expectStoreError(.invalid) { _ = try await f.page(ThreadQuery(view: .inbox, cursor: "garbage")) }
    }
}

@Suite("Store thread list: focused inbox and views")
struct StoreThreadListViewsTests {
    @Test func listsPeopleThreadsWithBundlesForNotificationsAndNewsletters() async throws {
        let f = try await Fixture()
        try await f.ing(
            f.s.inbox,
            StoreTestKit.msg(1) { $0.subject = "friend"; $0.from = [StoreTestKit.person("Friend")]; $0.date = StoreTestKit.t0 + 10 },
            StoreTestKit.msg(2) { $0.subject = "build passed"; $0.from = [StoreTestKit.person("CI", "noreply@ci.com")]; $0.date = StoreTestKit.t0 + 20 },
            StoreTestKit.msg(3) { $0.subject = "build failed"; $0.from = [StoreTestKit.person("CI", "alerts@ci.com")]; $0.date = StoreTestKit.t0 + 30; $0.flags = StoreTestKit.seen },
            StoreTestKit.msg(4) { $0.subject = "weekly"; $0.from = [StoreTestKit.person("Brand", "news@brand.com")]; $0.date = StoreTestKit.t0 + 40; $0.headers = ["list-id": "<b>"] })
        let page = try await f.page(ThreadQuery(view: .inbox, focused: true))
        #expect(page.items.map(\.subject) == ["friend"])
        #expect(page.bundles.map(\.category) == [.notifications, .newsletters])
        #expect(page.bundles[0].unreadCount == 1 && page.bundles[0].totalCount == 2 && page.bundles[0].lastDate == StoreTestKit.t0 + 30)
        #expect(page.bundles[0].latest.map(\.subject) == ["build failed", "build passed"])
        #expect(page.bundles[0].latest[0].from.address == "alerts@ci.com")
        #expect(page.bundles[1].totalCount == 1 && page.bundles[1].unreadCount == 1)
        let cat = try await f.page(ThreadQuery(view: .inbox, focused: true, category: .notifications))
        #expect(cat.items.map(\.subject) == ["build failed", "build passed"] && cat.bundles == [])
        #expect(try await f.page(ThreadQuery(view: .inbox)).items.count == 4)
        #expect(try await f.page(ThreadQuery(view: .sent, focused: true)).items == [])
    }

    @Test func coversSentDraftsTrashSpamArchivePinnedAndFolder() async throws {
        let f = try await Fixture()
        let custom = try await f.store.upsertFolder(f.s.account.id, FolderInput(path: "Projects"))
        try await f.ing(f.s.inbox, StoreTestKit.msg(1) { $0.subject = "in inbox" })
        try await f.ing(f.s.sent, StoreTestKit.msg(1) { $0.subject = "sent one"; $0.from = [StoreTestKit.me()]; $0.to = [StoreTestKit.person("Bo")] })
        try await f.ing(f.s.drafts, StoreTestKit.msg(1) { $0.subject = "draft one"; $0.from = [StoreTestKit.me()]; $0.flags = StoreTestKit.draftFlags })
        try await f.ing(f.s.trash, StoreTestKit.msg(1) { $0.subject = "trashed" })
        try await f.ing(f.s.spam, StoreTestKit.msg(1) { $0.subject = "spammy" })
        try await f.ing(f.s.archive, StoreTestKit.msg(1) { $0.subject = "archived" })
        try await f.ing(custom, StoreTestKit.msg(1) { $0.subject = "in project" })
        try await f.ing(f.s.inbox, StoreTestKit.msg(2) { $0.subject = "pinned inbox"; $0.flags = MessageFlags(flagged: true) })
        try await f.ing(f.s.trash, StoreTestKit.msg(2) { $0.subject = "pinned trash"; $0.flags = MessageFlags(flagged: true) })
        func subjects(_ q: ThreadQuery) async throws -> [String] { try await f.subjects(q).sorted() }
        #expect(try await subjects(ThreadQuery(view: .inbox)) == ["in inbox", "pinned inbox"])
        #expect(try await subjects(ThreadQuery(view: .sent)) == ["sent one"])
        #expect(try await subjects(ThreadQuery(view: .drafts)) == ["draft one"])
        #expect(try await subjects(ThreadQuery(view: .trash)) == ["pinned trash", "trashed"])
        #expect(try await subjects(ThreadQuery(view: .spam)) == ["spammy"])
        #expect(try await subjects(ThreadQuery(view: .archive)) == ["archived"])
        #expect(try await subjects(ThreadQuery(view: .pinned)) == ["pinned inbox"])
        #expect(try await subjects(ThreadQuery(view: .folder, folderId: custom.id)) == ["in project"])
        #expect(try await subjects(ThreadQuery(view: .folder)) == [])
        #expect(try await f.page(ThreadQuery(view: .drafts)).items[0].hasDraft)
    }

    @Test func blockedViewListsTrashedMailFromBlockedSenders() async throws {
        let f = try await Fixture()
        #expect(try await f.page(ThreadQuery(view: .blocked)).items == [])
        _ = try await f.store.blockSender("bad@x.com")
        try await f.ing(f.s.trash, StoreTestKit.msg(1) { $0.subject = "from bad"; $0.from = [StoreTestKit.person("Bad", "bad@x.com")] }, StoreTestKit.msg(2) { $0.subject = "ordinary trash"; $0.from = [StoreTestKit.person("Ok", "ok@x.com")] })
        #expect(try await f.subjects(ThreadQuery(view: .blocked)) == ["from bad"])
    }

    @Test func localDraftsMarkTheirThreadWithHasDraft() async throws {
        let f = try await Fixture()
        let o = try await f.ing(f.s.inbox, StoreTestKit.msg(1) { $0.subject = "needs reply" })[0]
        _ = try await f.store.createDraft(NewDraft(accountId: f.s.account.id, from: "me@example.com", mode: .reply, threadId: o.threadId), now: StoreTestKit.t0)
        #expect(try await f.page(ThreadQuery(view: .inbox)).items[0].hasDraft)
    }
}

@Suite("Store thread list: Gmail")
struct StoreThreadListGmailTests {
    @Test func usesLabelsForInboxAndDerivesArchiveFromAllMail() async throws {
        let store = try StoreTestKit.makeStore()
        let g = try await StoreTestKit.seedGmail(store)
        _ = try await store.ingestMessages(g.account.id, g.all.id, [
            StoreTestKit.msg(1) { $0.gmMsgid = "1"; $0.gmThrid = "A"; $0.subject = "inboxed"; $0.gmLabels = ["INBOX"] },
            StoreTestKit.msg(2) { $0.gmMsgid = "2"; $0.gmThrid = "B"; $0.subject = "archived"; $0.gmLabels = [] },
            StoreTestKit.msg(3) { $0.gmMsgid = "3"; $0.gmThrid = "C"; $0.subject = "only sent"; $0.from = [StoreTestKit.me()]; $0.to = [StoreTestKit.person("Bo")]; $0.gmLabels = ["[Gmail]/Sent Mail"] },
            StoreTestKit.msg(4) { $0.gmMsgid = "4"; $0.gmThrid = "D"; $0.subject = "starred archived"; $0.gmLabels = []; $0.flags = StoreTestKit.flaggedSeen },
        ], context: IngestContext())
        _ = try await store.ingestMessages(g.account.id, g.trash.id, [StoreTestKit.msg(1) { $0.gmMsgid = "5"; $0.gmThrid = "E"; $0.subject = "trashed"; $0.gmLabels = ["[Gmail]/Trash"] }], context: IngestContext())
        _ = try await store.ingestMessages(g.account.id, g.spam.id, [StoreTestKit.msg(1) { $0.gmMsgid = "6"; $0.gmThrid = "F"; $0.subject = "junk"; $0.gmLabels = ["[Gmail]/Spam"] }], context: IngestContext())
        func subjects(_ view: ThreadListView) async throws -> [String] {
            try await store.listThreads(ThreadQuery(view: view), now: StoreTestKit.t0 + StoreTestKit.day).items.map(\.subject).sorted()
        }
        #expect(try await subjects(.inbox) == ["inboxed"])
        #expect(try await subjects(.archive) == ["archived", "starred archived"])
        #expect(try await subjects(.sent) == ["only sent"])
        #expect(try await subjects(.trash) == ["trashed"])
        #expect(try await subjects(.spam) == ["junk"])
        #expect(try await subjects(.pinned) == ["starred archived"])
        #expect(try await store.listThreads(ThreadQuery(view: .inbox, accountId: g.account.id), now: StoreTestKit.t0 + StoreTestKit.day).items.count == 1)
    }

    @Test func archivingRemovesTheInboxLabelAndKeepsTheMessageInAllMail() async throws {
        let store = try StoreTestKit.makeStore()
        let g = try await StoreTestKit.seedGmail(store)
        let o = try await store.ingestMessages(g.account.id, g.all.id, [StoreTestKit.msg(1) { $0.gmMsgid = "1"; $0.gmThrid = "A"; $0.gmLabels = ["INBOX"] }], context: IngestContext())[0]
        let res = try await store.moveThreads([o.threadId], to: .archive)
        #expect(res.locations[0].memberFolderIds == [g.all.id])
        #expect(try await store.listThreads(ThreadQuery(view: .inbox), now: StoreTestKit.t0 + StoreTestKit.day).items == [])
        #expect(try await store.listThreads(ThreadQuery(view: .archive), now: StoreTestKit.t0 + StoreTestKit.day).items.count == 1)
    }
}

@Suite("Store thread list: search view")
struct StoreThreadListSearchTests {
    private static func local(_ y: Int, _ m: Int, _ d: Int) -> Int {
        Int(Calendar.current.date(from: DateComponents(year: y, month: m, day: d))!.timeIntervalSince1970 * 1000)
    }

    private func seed() async throws -> (f: Fixture, msgs: Int) {
        let f = try await Fixture()
        try await f.ing(
            f.s.inbox,
            StoreTestKit.msg(1) {
                $0.subject = "Quarterly budget"; $0.from = [StoreTestKit.person("Zelda", "zelda@acme.com")]; $0.to = [StoreTestKit.me()]; $0.date = Self.local(2026, 6, 10)
                $0.textBody = "numbers for the board"; $0.hasAttachments = true
            },
            StoreTestKit.msg(2) {
                $0.subject = "Lunch plans"; $0.from = [StoreTestKit.person("Pat", "pat@home.org")]; $0.to = [StoreTestKit.me()]; $0.date = Self.local(2026, 9, 10)
                $0.textBody = "tacos on friday"; $0.flags = StoreTestKit.seen
            })
        try await f.ing(f.s.sent, StoreTestKit.msg(1) {
            $0.subject = "Re: Lunch plans"; $0.from = [StoreTestKit.me()]; $0.to = [StoreTestKit.person("Pat", "pat@home.org")]; $0.cc = [StoreTestKit.person("Quinn")]
            $0.date = Self.local(2026, 9, 11); $0.textBody = "friday works"; $0.flags = StoreTestKit.seen
        })
        try await f.ing(f.s.trash, StoreTestKit.msg(1) { $0.subject = "Budget leftovers"; $0.from = [StoreTestKit.person("Trashy")]; $0.textBody = "budget"; $0.date = Self.local(2026, 8, 1) })
        return (f, 4)
    }

    private func run(_ f: Fixture, _ search: String) async throws -> [String] {
        try await f.store.listThreads(ThreadQuery(view: .search, search: search), now: StoreTestKit.t0).items.map(\.subject).sorted()
    }

    @Test func matchesWordsWithPrefixOnTheLastWord() async throws {
        let (f, _) = try await seed()
        #expect(try await run(f, "budget") == ["Quarterly budget"])
        #expect(try await run(f, "quart") == ["Quarterly budget"])
        #expect(try await run(f, "board numbers") == ["Quarterly budget"])
        #expect(try await run(f, "\"tacos on friday\"") == ["Lunch plans"])
        #expect(try await run(f, "friday -tacos") == ["Lunch plans"])
        #expect(try await run(f, "") == [])
    }

    @Test func supportsOperators() async throws {
        let (f, _) = try await seed()
        #expect(try await run(f, "from:zelda") == ["Quarterly budget"])
        #expect(try await run(f, "from:@home.org") == ["Lunch plans"])
        #expect(try await run(f, "to:pat") == ["Lunch plans"])
        #expect(try await run(f, "cc:quinn") == ["Lunch plans"])
        #expect(try await run(f, "subject:lunch") == ["Lunch plans"])
        #expect(try await run(f, "has:attachment") == ["Quarterly budget"])
        #expect(try await run(f, "is:unread") == ["Quarterly budget"])
        #expect(try await run(f, "is:read") == ["Lunch plans"])
        #expect(try await run(f, "in:sent") == ["Lunch plans"])
        #expect(try await run(f, "in:trash budget") == ["Budget leftovers"])
        #expect(try await run(f, "after:2026-09-01") == ["Lunch plans"])
        #expect(try await run(f, "before:2026-07-01") == ["Quarterly budget"])
        #expect(try await run(f, "account:me@example.com from:pat") == ["Lunch plans"])
        #expect(try await run(f, "account:other@example.com") == [])
        #expect(try await run(f, "from:zelda -has:attachment") == [])
    }

    @Test func supportsIsPinnedIsSnoozedAndInFolderName() async throws {
        let (f, _) = try await seed()
        let lunch = try await f.store.listThreads(ThreadQuery(view: .search, search: "lunch"), now: StoreTestKit.t0).items[0].id
        _ = try await f.store.setPinned([lunch], pinned: true)
        #expect(try await run(f, "is:pinned") == ["Lunch plans"])
        let quarterly = try await f.store.listThreads(ThreadQuery(view: .search, search: "quarterly"), now: StoreTestKit.t0).items[0].id
        _ = try await f.store.snooze([quarterly], until: StoreTestKit.t0 + StoreTestKit.day)
        #expect(try await run(f, "is:snoozed") == ["Quarterly budget"])
        #expect(try await run(f, "in:inbox") == ["Lunch plans", "Quarterly budget"])
        #expect(try await run(f, "in:INBOX is:read") == ["Lunch plans"])
        #expect(try await run(f, "in:Sent") == ["Lunch plans"])
    }

    @Test func neverThrowsOnHostileInput() async throws {
        let (f, _) = try await seed()
        for q in ["\"", "AND OR NOT", "NEAR(", "col:val", "*", "a*b", "(((", "-", "'; DROP TABLE messages; --", "\u{0}", "from:", "before:nope"] {
            _ = try await run(f, q)
        }
        #expect(try await StoreTestKit.count(f.store, "SELECT COUNT(*) FROM messages") == 4)
    }
}

@Suite("Store thread list: receipts and unified inbox")
struct StoreThreadListReceiptsTests {
    @Test func includesASummaryWhenTheThreadsLatestSentMailIsTracked() async throws {
        let f = try await Fixture()
        let o = try await f.ing(f.s.sent, StoreTestKit.msg(1) { $0.messageId = "sent1@x"; $0.subject = "Proposal"; $0.from = [StoreTestKit.me()]; $0.to = [StoreTestKit.person("Carla"), StoreTestKit.person("Dan")]; $0.flags = StoreTestKit.seen })[0]
        let tid = try await f.store.createTracked(NewTracked(
            accountId: f.s.account.id, ref: "r1", messageId: "sent1@x", threadId: o.threadId, subject: "Proposal", sentAt: StoreTestKit.t0,
            recipients: [.init(email: "carla@example.org", token: "t1"), .init(email: "dan@example.org", token: "t2")]))
        _ = try await f.store.ingestReceiptEvents([ReceiptEventInput(remoteId: "e1", token: "t1", at: StoreTestKit.t0 + 60_000, kind: .open, client: "Gmail", fingerprint: "f1")], now: StoreTestKit.t0)
        #expect(tid > 0)
        #expect(try await f.page(ThreadQuery(view: .sent)).items[0].receipt == ReceiptSummary(opened: 1, total: 2, status: .opened, lastOpenAt: StoreTestKit.t0 + 60_000))
        // A later mail from me that is not tracked hides the summary.
        try await f.ing(f.s.sent, StoreTestKit.msg(2) { $0.messageId = "sent2@x"; $0.references = ["sent1@x"]; $0.subject = "Re: Proposal"; $0.from = [StoreTestKit.me()]; $0.to = [StoreTestKit.person("Carla")]; $0.date = StoreTestKit.t0 + StoreTestKit.day; $0.flags = StoreTestKit.seen })
        #expect(try await f.page(ThreadQuery(view: .sent)).items[0].receipt == nil)
    }

    private func two() async throws -> (store: GRDBStore, a: StoreImapSeed, b: StoreImapSeed) {
        let store = try StoreTestKit.makeStore()
        let a = try await StoreTestKit.seedImap(store, "a@example.com")
        let b = try await StoreTestKit.seedImap(store, "b@example.com")
        let from = [StoreTestKit.person("Ann", "ann@example.org")]
        _ = try await store.ingestMessages(a.account.id, a.inbox.id, [StoreTestKit.msg(1) { $0.subject = "For A"; $0.from = from; $0.date = StoreTestKit.t0 }], context: IngestContext())
        _ = try await store.ingestMessages(b.account.id, b.inbox.id, [StoreTestKit.msg(1) { $0.subject = "For B"; $0.from = from; $0.date = StoreTestKit.t0 + 1000 }], context: IngestContext())
        return (store, a, b)
    }

    private func subjects(_ store: GRDBStore, _ q: ThreadQuery) async throws -> [String] {
        try await store.listThreads(q, now: StoreTestKit.t0 + 5000).items.map(\.subject).sorted()
    }

    @Test func aHiddenAccountLeavesEveryAllAccountsViewButKeepsItsOwnInbox() async throws {
        let (store, a, b) = try await two()
        #expect(try await store.account(id: a.account.id)?.showInUnified == true)
        #expect(try await subjects(store, ThreadQuery(view: .inbox)) == ["For A", "For B"])
        _ = try await store.updateAccount(b.account.id, AccountPatch(showInUnified: false))
        #expect(try await subjects(store, ThreadQuery(view: .inbox)) == ["For A"])
        #expect(try await subjects(store, ThreadQuery(view: .inbox, focused: true)) == ["For A"])
        #expect(try await subjects(store, ThreadQuery(view: .search, search: "For")) == ["For A"])
        #expect(try await subjects(store, ThreadQuery(view: .inbox, accountId: b.account.id)) == ["For B"])
        #expect(try await subjects(store, ThreadQuery(view: .search, accountId: b.account.id, search: "For")) == ["For B"])
        _ = try await store.updateAccount(b.account.id, AccountPatch(showInUnified: true))
        #expect(try await subjects(store, ThreadQuery(view: .inbox)) == ["For A", "For B"])
    }

    @Test func appliesToPinnedViewAndBundles() async throws {
        let (store, a, b) = try await two()
        for acc in [a, b] {
            let t = try await store.listThreads(ThreadQuery(view: .inbox, accountId: acc.account.id), now: StoreTestKit.t0 + 5000).items[0]
            _ = try await store.setPinned([t.id], pinned: true)
        }
        _ = try await store.updateAccount(b.account.id, AccountPatch(showInUnified: false))
        #expect(try await subjects(store, ThreadQuery(view: .pinned)) == ["For A"])
        #expect(try await subjects(store, ThreadQuery(view: .pinned, accountId: b.account.id)) == ["For B"])
        _ = try await store.ingestMessages(b.account.id, b.inbox.id, [StoreTestKit.msg(5) { $0.subject = "News B"; $0.date = StoreTestKit.t0 + 2000; $0.headers = ["list-id": "<n.b.org>", "list-unsubscribe": "<https://b.org/u>"] }], context: IngestContext())
        _ = try await store.ingestMessages(a.account.id, a.inbox.id, [StoreTestKit.msg(5) { $0.subject = "News A"; $0.date = StoreTestKit.t0 + 2000; $0.headers = ["list-id": "<n.a.org>", "list-unsubscribe": "<https://a.org/u>"] }], context: IngestContext())
        let page = try await store.listThreads(ThreadQuery(view: .inbox, focused: true), now: StoreTestKit.t0 + 5000)
        #expect(page.bundles.map { $0.latest.map(\.subject) } == [["News A"]])
    }
}
