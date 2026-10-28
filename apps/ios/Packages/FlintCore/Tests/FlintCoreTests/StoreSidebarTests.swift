import FlintModel
import Foundation
import Testing
@testable import FlintStore

@Suite("Store sidebar")
struct StoreSidebarTests {
    @Test func countsUnreadInboxThreadsPerAccountWithFoldersAndBadges() async throws {
        let store = try StoreTestKit.makeStore()
        let a = try await StoreTestKit.seedImap(store, "a@example.com")
        let b = try await StoreTestKit.seedGmail(store, "b@gmail.com")
        _ = try await store.ingestMessages(a.account.id, a.inbox.id, [
            StoreTestKit.msg(1) { $0.subject = "one"; $0.from = [StoreTestKit.person("A")] }, StoreTestKit.msg(2) { $0.subject = "two"; $0.from = [StoreTestKit.person("B")] },
            StoreTestKit.msg(3) { $0.subject = "read"; $0.from = [StoreTestKit.person("C")]; $0.flags = StoreTestKit.flaggedSeen },
        ], context: IngestContext())
        _ = try await store.ingestMessages(a.account.id, a.spam.id, [StoreTestKit.msg(1) { $0.subject = "junk" }], context: IngestContext())
        _ = try await store.ingestMessages(b.account.id, b.all.id, [StoreTestKit.msg(1) { $0.gmMsgid = "1"; $0.gmThrid = "T"; $0.subject = "gmail one"; $0.gmLabels = ["INBOX"] }], context: IngestContext())
        let snoozed = try await store.ingestMessages(a.account.id, a.inbox.id, [StoreTestKit.msg(9) { $0.subject = "later"; $0.from = [StoreTestKit.person("D")] }], context: IngestContext())[0]
        let now = StoreTestKit.t0 + StoreTestKit.day
        _ = try await store.snooze([snoozed.threadId], until: now + StoreTestKit.day)
        _ = try await store.createDraft(NewDraft(accountId: a.account.id, from: "a@example.com"), now: now)
        let d = try await store.createDraft(NewDraft(accountId: a.account.id, from: "a@example.com", subject: "x"), now: now)
        _ = try await store.createScheduledSend(NewScheduledSend(draftId: d.id, sendAt: 1), now: now)
        _ = try await store.createScheduledSend(NewScheduledSend(draftId: d.id, sendAt: 2, status: .awaitingApproval), now: now)

        let side = try await store.sidebarData(now: now)
        #expect(side.accounts.map { "\($0.account.email):\($0.inboxUnread)" } == ["a@example.com:2", "b@gmail.com:1"])
        #expect(side.accounts[0].folders.map(\.path).contains("INBOX"))
        #expect(side.accounts[0].sync.state == .idle && side.accounts[0].sync.accountId == a.account.id)
        #expect(side.counts == SidebarCounts(inbox: 3, pinned: 1, drafts: 1, snoozed: 1, scheduled: 1, spam: 1))
    }

    @Test func ignoresDisabledAccountsInBadgeCounts() async throws {
        let store = try StoreTestKit.makeStore()
        let a = try await StoreTestKit.seedImap(store)
        _ = try await store.ingestMessages(a.account.id, a.inbox.id, [StoreTestKit.msg(1)], context: IngestContext())
        _ = try await store.updateAccount(a.account.id, AccountPatch(enabled: false))
        #expect(try await store.sidebarData(now: StoreTestKit.t0 + StoreTestKit.day).counts.inbox == 0)
    }

    @Test func aHiddenAccountLeavesTheTotalsButKeepsItsOwnUnread() async throws {
        let store = try StoreTestKit.makeStore()
        let a = try await StoreTestKit.seedImap(store, "a@example.com")
        let b = try await StoreTestKit.seedImap(store, "b@example.com")
        _ = try await store.ingestMessages(a.account.id, a.inbox.id, [StoreTestKit.msg(1)], context: IngestContext())
        _ = try await store.ingestMessages(b.account.id, b.inbox.id, [StoreTestKit.msg(1)], context: IngestContext())
        let now = StoreTestKit.t0 + StoreTestKit.day
        #expect(try await store.sidebarData(now: now).counts.inbox == 2)
        _ = try await store.updateAccount(b.account.id, AccountPatch(showInUnified: false))
        let data = try await store.sidebarData(now: now)
        #expect(data.counts.inbox == 1)
        #expect(data.accounts.first { $0.account.id == b.account.id }?.inboxUnread == 1)
    }

    @Test func reportsTheLastSyncTimeFromTheFolders() async throws {
        let store = try StoreTestKit.makeStore()
        let a = try await StoreTestKit.seedImap(store)
        try await store.setFolderSyncState(a.inbox.id, FolderSyncPatch(lastSyncAt: .some(123)))
        try await store.setFolderSyncState(a.sent.id, FolderSyncPatch(lastSyncAt: .some(456)))
        #expect(try await store.sidebarData(now: StoreTestKit.t0).accounts[0].sync.lastSyncAt == 456)
    }

    private func folder(_ id: Int, _ path: String, _ role: MailboxRole?, name: String? = nil) -> Folder {
        Folder(id: id, accountId: "a", path: path, name: name ?? String(path.split(separator: "/").last ?? ""), role: role)
    }

    @Test func hidesTheAllImportantAndFlaggedDuplicates() {
        let out = SidebarSQL.folders([
            folder(1, "INBOX", .inbox), folder(2, "[Gmail]/All Mail", .all), folder(3, "[Gmail]/Important", .important), folder(4, "[Gmail]/Starred", .flagged),
            folder(5, "[Gmail]/Sent Mail", .sent), folder(6, "Work", nil),
        ])
        #expect(out.map(\.path) == ["INBOX", "[Gmail]/Sent Mail", "Work"])
    }

    @Test func renamesAUserLabelThatCollidesWithASystemName() {
        let out = SidebarSQL.folders([folder(1, "[Gmail]/Important", .important), folder(2, "Important", nil), folder(3, "INBOX", .inbox)])
        #expect(out.map(\.name) == ["Important (label)", "INBOX"])
    }

    @Test func neverShowsTwoFoldersWithTheSameName() {
        let out = SidebarSQL.folders([
            folder(1, "INBOX", .inbox), folder(2, "Clients/Acme", nil), folder(3, "Vendors/Acme", nil), folder(4, "Sent", nil), folder(5, "[Gmail]/Sent Mail", .sent),
        ])
        let names = out.map { $0.name.lowercased() }
        #expect(Set(names).count == names.count)
        #expect(out.first { $0.path == "[Gmail]/Sent Mail" }?.name == "Sent Mail")
    }

    @Test func isWhatTheSidebarReturnsForAGmailAccount() async throws {
        let store = try StoreTestKit.makeStore()
        let g = try await StoreTestKit.seedGmail(store)
        _ = try await store.upsertFolder(g.account.id, FolderInput(path: "[Gmail]/Important", role: .important))
        _ = try await store.upsertFolder(g.account.id, FolderInput(path: "Important", role: nil))
        let folders = try await store.sidebarData(now: StoreTestKit.t0).accounts[0].folders
        #expect(!folders.contains { $0.role == .all || $0.role == .important })
        #expect(folders.filter { $0.name == "Important" }.isEmpty)
        #expect(folders.first { $0.path == "Important" }?.name == "Important (label)")
    }
}
