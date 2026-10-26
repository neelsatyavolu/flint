import FlintModel
import Foundation
import Testing
@testable import FlintStore

@Suite("Store server drafts in threads")
struct StoreServerDraftsTests {
    private func threadWithDraft() async throws -> (store: GRDBStore, s: StoreImapSeed, threadId: ThreadID) {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        let a = try await store.ingestMessages(s.account.id, s.inbox.id, [StoreTestKit.msg(1) { $0.messageId = "a@x"; $0.subject = "Plan"; $0.date = StoreTestKit.t0 }], context: IngestContext())[0]
        let d = try await store.ingestMessages(s.account.id, s.drafts.id, [StoreTestKit.msg(1) {
            $0.messageId = "d@x"; $0.inReplyTo = "a@x"; $0.references = ["a@x"]; $0.subject = "Re: Plan"; $0.from = [StoreTestKit.me()]; $0.to = [StoreTestKit.person("Carla")]
            $0.flags = StoreTestKit.draftFlags; $0.date = StoreTestKit.t0 + 5 * StoreTestKit.day; $0.snippet = "half written reply"
        }], context: IngestContext())[0]
        #expect(d.threadId == a.threadId)
        return (store, s, a.threadId)
    }

    @Test func keepsDraftsOutOfTheConversationLastDateAndCounts() async throws {
        let (store, _, threadId) = try await threadWithDraft()
        let rows = try #require(try await store.threadRows(threadId))
        #expect(rows.messages.map(\.messageId) == ["a@x"])
        let item = try #require(try await store.listThreads(ThreadQuery(view: .inbox), now: StoreTestKit.t0 + StoreTestKit.day).items.first { $0.id == threadId })
        #expect(item.messageCount == 1 && item.lastDate == StoreTestKit.t0 && !item.snippet.contains("half written") && item.hasDraft)
        #expect(try await StoreTestKit.count(store, "SELECT last_date FROM threads WHERE id = ?", [threadId]) == StoreTestKit.t0)
    }

    @Test func stillListsADraftOnlyThreadInTheDraftsFolderAndOpensIt() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        let d = try await store.ingestMessages(s.account.id, s.drafts.id, [StoreTestKit.msg(1) { $0.subject = "Fresh draft"; $0.from = [StoreTestKit.me()]; $0.flags = StoreTestKit.draftFlags }], context: IngestContext())[0]
        #expect(try await store.listThreads(ThreadQuery(view: .drafts), now: StoreTestKit.t0).items.map(\.id).contains(d.threadId))
        #expect(try await store.threadRows(d.threadId)?.messages.count == 1)
    }
}

@Suite("Store joining by subject")
struct StoreSubjectJoinTests {
    private func two(_ a: @escaping (inout IngestMessage) -> Void, _ b: @escaping (inout IngestMessage) -> Void) async throws -> Bool {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        let first = try await store.ingestMessages(s.account.id, s.inbox.id, [StoreTestKit.msg(1, a)], context: IngestContext())[0]
        let second = try await store.ingestMessages(s.account.id, s.inbox.id, [StoreTestKit.msg(2, b)], context: IngestContext())[0]
        return first.threadId == second.threadId
    }

    @Test func joinsAnUnlinkedReplyFromTheSamePersonWithTheSameSubject() async throws {
        #expect(try await two({ $0.messageId = "a@x"; $0.subject = "Project kickoff notes" }, { $0.messageId = nil; $0.subject = "Re: Project kickoff notes"; $0.date = StoreTestKit.t0 + StoreTestKit.day }))
    }

    @Test func doesNotJoinGenericSubjects() async throws {
        #expect(try await !two({ $0.messageId = "a@x"; $0.subject = "Hello" }, { $0.messageId = "b@x"; $0.subject = "Hello"; $0.date = StoreTestKit.t0 + StoreTestKit.day }))
        #expect(try await !two({ $0.messageId = "a@x"; $0.subject = "Invoice" }, { $0.messageId = "b@x"; $0.subject = "Invoice"; $0.date = StoreTestKit.t0 + StoreTestKit.day }))
    }

    @Test func doesNotJoinListOrAutomatedMail() async throws {
        let list = ["list-unsubscribe": "<mailto:u@x>"]
        let digest = "Your weekly digest is ready"
        #expect(try await !two({ $0.messageId = "a@x"; $0.subject = digest }, { $0.messageId = "b@x"; $0.subject = digest; $0.date = StoreTestKit.t0 + StoreTestKit.day; $0.headers = list }))
        #expect(try await !two({ $0.messageId = "a@x"; $0.subject = digest; $0.headers = list }, { $0.messageId = "b@x"; $0.subject = digest; $0.date = StoreTestKit.t0 + StoreTestKit.day }))
        let build = "Build finished successfully"
        #expect(try await !two({ $0.messageId = "a@x"; $0.subject = build }, { $0.messageId = "b@x"; $0.subject = build; $0.date = StoreTestKit.t0 + StoreTestKit.day; $0.headers = ["auto-submitted": "auto-generated"] }))
    }

    @Test func keepsBracketedTagsSignificant() async throws {
        #expect(try await !two({ $0.messageId = "a@x"; $0.subject = "[repo-a] Fix the parser" }, { $0.messageId = "b@x"; $0.subject = "[repo-b] Fix the parser"; $0.date = StoreTestKit.t0 + StoreTestKit.day }))
    }

    @Test func doesNotJoinThroughADraft() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        _ = try await store.ingestMessages(s.account.id, s.drafts.id, [StoreTestKit.msg(1) {
            $0.messageId = "d@x"; $0.subject = "Project kickoff notes"; $0.from = [StoreTestKit.me()]; $0.to = [StoreTestKit.person("Carla")]; $0.flags = StoreTestKit.draftFlags
        }], context: IngestContext())
        let b = try await store.ingestMessages(s.account.id, s.inbox.id, [StoreTestKit.msg(2) { $0.messageId = "b@x"; $0.subject = "Project kickoff notes"; $0.date = StoreTestKit.t0 + StoreTestKit.day }], context: IngestContext())[0]
        #expect(try await store.threadRows(b.threadId)?.messages.count == 1)
    }
}

@Suite("Store recategorize")
struct StoreRecategorizeTests {
    @Test func relabelsExistingMailFromStoredHeadersAndRecomputesThreads() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        let scoir = try await store.ingestMessages(s.account.id, s.inbox.id, [StoreTestKit.msg(1) {
            $0.messageId = "s@x"; $0.subject = "A school viewed your profile"; $0.from = [StoreTestKit.person("Scoir", "automated@notifications.scoir.com")]
        }], context: IngestContext())[0]
        let pal = try await store.ingestMessages(s.account.id, s.inbox.id, [StoreTestKit.msg(2) { $0.messageId = "p@x"; $0.subject = "Lunch"; $0.from = [StoreTestKit.person("Pal", "pal@example.org")] }], context: IngestContext())[0]
        // Simulate mail labelled by the old categorizer, and a contact the user has written to.
        try await StoreTestKit.exec(store, "UPDATE messages SET category = 'people'")
        try await StoreTestKit.exec(store, "UPDATE threads SET category = 'people'")
        try await StoreTestKit.exec(store, "UPDATE messages SET headers_json = ? WHERE message_id = 's@x'", [#"{"feedback-id":"1:scoir"}"#])
        try await store.touchSent(StoreTestKit.person("Pal", "pal@example.org"), date: StoreTestKit.t0)
        #expect(try await store.recategorizeAll() == 1)
        #expect(try await store.threadRows(scoir.threadId)?.category == .notifications)
        #expect(try await store.threadRows(pal.threadId)?.category == .people)
        #expect(try await store.recategorizeAll() == 0)
    }

    @Test func keepsACategoryARuleOrTheUserChose() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        let scoir = try await store.ingestMessages(s.account.id, s.inbox.id, [StoreTestKit.msg(1) {
            $0.messageId = "s@x"; $0.subject = "A school viewed your profile"; $0.from = [StoreTestKit.person("Scoir", "automated@notifications.scoir.com")]
        }], context: IngestContext())[0]
        let other = try await store.ingestMessages(s.account.id, s.inbox.id, [StoreTestKit.msg(2) {
            $0.messageId = "o@x"; $0.subject = "Your receipt"; $0.from = [StoreTestKit.person("Shop", "automated@notifications.shop.com")]
        }], context: IngestContext())[0]
        try await StoreTestKit.exec(store, "UPDATE messages SET headers_json = ?", [#"{"feedback-id":"1:scoir"}"#])
        try await StoreTestKit.exec(store, "UPDATE messages SET category = 'people'")
        try await store.pinCategory([scoir.threadId], .people, source: .rule)
        try await store.pinCategory([other.threadId], .people, source: .manual)
        #expect(try await store.recategorizeAll() == 0)
        #expect(try await store.threadRows(scoir.threadId)?.category == .people)
        #expect(try await store.threadRows(other.threadId)?.category == .people)
    }

    @Test func recordsARulesCategoryOnIngestAndKeepsItThroughRecategorizing() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        _ = try await store.saveRule(StoreTestKit.rule("Scoir to people", conditions: [RuleCondition(field: .from, op: .contains, value: "scoir")], actions: [.category(.people)]))
        let scoir = try await store.ingestMessages(s.account.id, s.inbox.id, [StoreTestKit.msg(1) {
            $0.messageId = "s@x"; $0.subject = "A school viewed your profile"; $0.from = [StoreTestKit.person("Scoir", "automated@notifications.scoir.com")]; $0.headers = ["feedback-id": "1:scoir"]
        }], context: IngestContext())[0]
        #expect(try await store.threadRows(scoir.threadId)?.category == .people)
        #expect(try await store.recategorizeAll() == 0)
        #expect(try await store.threadRows(scoir.threadId)?.category == .people)
    }

    @Test func leavesSentMailAlone() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        _ = try await store.ingestMessages(s.account.id, s.sent.id, [StoreTestKit.msg(1) { $0.from = [StoreTestKit.me()]; $0.to = [StoreTestKit.person("Bob", "noreply@brand.com")] }], context: IngestContext())
        #expect(try await store.recategorizeAll() == 0)
    }
}

@Suite("Store header refresh")
struct StoreHeaderRefreshTests {
    @Test func listsRecentReceivedInboxMailByUidFolderAndSkipsRuleSetCategories() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        _ = try await store.ingestMessages(s.account.id, s.inbox.id, [
            StoreTestKit.msg(1) { $0.date = StoreTestKit.t0 }, StoreTestKit.msg(2) { $0.date = StoreTestKit.t0 - 200 * StoreTestKit.day }, StoreTestKit.msg(3) { $0.date = StoreTestKit.t0 },
        ], context: IngestContext(evaluate: false))
        _ = try await store.ingestMessages(s.account.id, s.archive.id, [StoreTestKit.msg(9) { $0.date = StoreTestKit.t0 }], context: IngestContext(evaluate: false))
        let tid = try #require(try await store.message(folderId: s.inbox.id, uid: 3)?.threadId)
        try await store.pinCategory([tid], .notifications, source: .rule)
        #expect(try await store.headerRefreshTargets(accountId: s.account.id, sinceMs: StoreTestKit.t0 - 90 * StoreTestKit.day) == [HeaderRefreshTarget(folderId: s.inbox.id, folderPath: "INBOX", uids: [1])])
    }

    @Test func usesTheAllMailUidForGmailInboxMail() async throws {
        let store = try StoreTestKit.makeStore()
        let g = try await StoreTestKit.seedGmail(store)
        _ = try await store.ingestMessages(g.account.id, g.all.id, [
            StoreTestKit.msg(41) { $0.gmMsgid = "g1"; $0.gmThrid = "t1"; $0.gmLabels = ["INBOX"]; $0.date = StoreTestKit.t0 },
            StoreTestKit.msg(42) { $0.gmMsgid = "g2"; $0.gmThrid = "t2"; $0.gmLabels = []; $0.date = StoreTestKit.t0 },
        ], context: IngestContext(evaluate: false))
        #expect(try await store.headerRefreshTargets(accountId: g.account.id, sinceMs: StoreTestKit.t0 - StoreTestKit.day) == [HeaderRefreshTarget(folderId: g.all.id, folderPath: "[Gmail]/All Mail", uids: [41])])
    }

    @Test func mergesFetchedHeadersSoRecategorizingSeesThem() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        _ = try await store.ingestMessages(s.account.id, s.inbox.id, [StoreTestKit.msg(5) {
            $0.from = [StoreTestKit.person("UGA Admissions", "apply@uga.edu")]; $0.subject = "Your application is complete"; $0.headers = ["list-id": "x"]
        }], context: IngestContext(evaluate: false))
        let n = try await store.mergeHeaders(s.inbox.id, [
            (uid: 5, headers: ["feedback-id": "1:slate:technolutions", "return-path": "<bounce@slate-mx.technolutions.net>"]), (uid: 6, headers: ["a": "b"]),
        ])
        #expect(n == 1)
        let row = try #require(try await store.message(folderId: s.inbox.id, uid: 5))
        #expect(row.headers["list-id"] == "x" && row.headers["feedback-id"] == "1:slate:technolutions")
    }
}
