import FlintModel
import Foundation
import Testing
@testable import FlintStore

@Suite("Store messages and flags")
struct StoreMessagesTests {
    @Test func findsByIdMessageIDAndFolderUidAndUpdatesFlags() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        let o = try await StoreTestKit.ingest(store, s, s.inbox, StoreTestKit.msg(5) { $0.messageId = "<abc@x>"; $0.subject = "Hi"; $0.textBody = "body text" })[0]
        let m = try #require(try await store.message(id: o.messageRowId))
        #expect(m.uid == 5 && m.messageId == "abc@x" && m.bodyLoaded && m.text == "body text" && !m.seen)
        #expect(try await store.messages(accountId: s.account.id, messageId: "<abc@x>").count == 1)
        #expect(try await store.message(folderId: s.inbox.id, uid: 5)?.id == m.id)
        #expect(try await store.message(folderId: s.inbox.id, uid: 6) == nil)
        let changed = try await store.applyFlags(s.inbox.id, [FlagUpdate(uid: 5, seen: true, flagged: true), FlagUpdate(uid: 99, seen: true)])
        #expect(changed == [m.threadId])
        let after = try #require(try await store.message(id: m.id))
        #expect(after.seen && after.flagged)
        #expect(try await store.threadRows(m.threadId)?.pinned == true)
        #expect(try await store.applyFlags(s.inbox.id, [FlagUpdate(uid: 5, seen: true)]) == [])
        _ = try await store.applyFlags(s.inbox.id, [FlagUpdate(uid: 5, flagged: false)])
        #expect(try await store.threadRows(m.threadId)?.pinned == false)
    }

    @Test func removeUidsDeletesMessagesSearchRowsAndEmptyThreads() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        _ = try await StoreTestKit.ingest(store, s, s.inbox, StoreTestKit.msg(1) { $0.subject = "one"; $0.textBody = "quokka" }, StoreTestKit.msg(2) { $0.subject = "two" })
        #expect(try await store.listLocalUids(s.inbox.id, minUid: 0) == [1, 2])
        #expect(try await store.listLocalUids(s.inbox.id, minUid: 2) == [2])
        let threads = try await store.removeUids(s.inbox.id, [1])
        #expect(threads.count == 1)
        #expect(try await store.listLocalUids(s.inbox.id, minUid: 0) == [2])
        #expect(try await StoreTestKit.count(store, "SELECT COUNT(*) FROM messages_fts WHERE messages_fts MATCH 'quokka'") == 0)
        #expect(try await store.removeUids(s.inbox.id, []) == [])
    }

    @Test func setBodyStoresBodiesAttachmentsSnippetAndRefreshesTheIndex() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        let o = try await StoreTestKit.ingest(store, s, s.inbox, StoreTestKit.msg(1) { $0.subject = "Plan" })[0]
        let before = try #require(try await store.message(id: o.messageRowId))
        #expect(!before.bodyLoaded && before.snippet == "")
        try await store.setBody(o.messageRowId, MessageBody(
            text: nil, html: "<p>Budget <b>numbers</b></p><style>.x{color:red}</style>",
            attachments: [
                IngestAttachment(part: "2", filename: "a.pdf", contentType: "application/pdf", size: 10),
                IngestAttachment(part: "3", filename: "i.png", contentType: "image/png", size: 5, contentId: "cid1", inline: true),
            ]))
        let m = try #require(try await store.message(id: o.messageRowId))
        #expect(m.bodyLoaded && m.hasAttachments)
        #expect(m.snippet == "Budget numbers")
        let rows = try #require(try await store.threadRows(m.threadId))
        let atts = rows.messages[0].attachments
        #expect(atts.map { [$0.filename, String($0.inline)] } == [["a.pdf", "false"], ["i.png", "true"]])
        #expect(try await store.listThreads(ThreadQuery(view: .search, search: "numbers"), now: StoreTestKit.t0).items.count == 1)
        #expect(try await store.listThreads(ThreadQuery(view: .search, search: "color"), now: StoreTestKit.t0).items.count == 0)
        await expectStoreError(.notFound) { try await store.setBody(9999, MessageBody(text: "x")) }
        let stored = try #require(try await store.attachment(id: atts[0].id))
        #expect(stored.part == "2" && stored.messageRowId == m.id && stored.cachedPath == nil)
        try await store.setAttachmentCachedPath(atts[0].id, "/tmp/x")
        #expect(try await store.attachment(id: atts[0].id)?.cachedPath == "/tmp/x")
    }

    @Test func threadRowsReturnOldestFirstWithUnsubscribeInfoAndFromMe() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        let out = try await StoreTestKit.ingest(
            store, s, s.inbox,
            StoreTestKit.msg(2) { $0.messageId = "b@x"; $0.inReplyTo = "a@x"; $0.references = ["a@x"]; $0.date = StoreTestKit.t0 + 2000; $0.from = [StoreTestKit.me()]; $0.to = [StoreTestKit.person("Carla")] },
            StoreTestKit.msg(1) {
                $0.messageId = "a@x"; $0.date = StoreTestKit.t0
                $0.headers = ["list-unsubscribe": "<https://u.example/x>, <mailto:u@example.org>", "list-unsubscribe-post": "List-Unsubscribe=One-Click"]
            })
        #expect(out[0].threadId == out[1].threadId)
        let rows = try #require(try await store.threadRows(out[0].threadId))
        #expect(rows.messages.map(\.uid) == [1, 2])
        #expect(rows.messages.map(\.isFromMe) == [false, true])
        #expect(rows.messages[0].unsubscribe == UnsubscribeInfo(url: "https://u.example/x", mailto: "mailto:u@example.org", oneClick: true))
        #expect(rows.messages[1].unsubscribe == nil)
        #expect(try await store.threadRows(9999) == nil)
    }

    @Test func threadLocationsCarryMembershipForImapActions() async throws {
        let store = try StoreTestKit.makeStore()
        let g = try await StoreTestKit.seedGmail(store)
        let o = try await store.ingestMessages(g.account.id, g.all.id, [StoreTestKit.msg(10) { $0.gmMsgid = "1"; $0.gmThrid = "t1"; $0.gmLabels = ["INBOX", "[Gmail]/Sent Mail"] }], context: IngestContext())[0]
        let loc = try #require(try await store.threadLocations([o.threadId]).first)
        #expect(loc.provider == .gmail && loc.folderPath == "[Gmail]/All Mail" && loc.folderRole == .all && loc.uid == 10 && loc.gmMsgid == "1")
        #expect(loc.memberFolderIds.sorted() == [g.all.id, g.inbox.id, g.sent.id].sorted())
        #expect(try await store.messageLocations([o.messageRowId]).count == 1)
    }
}
