import FlintModel
import Foundation
import Testing
@testable import FlintStore

@Suite("Store accounts and folders")
struct StoreAccountsFoldersTests {
    @Test func createsReadsUpdatesListsAndDeletes() async throws {
        let store = try StoreTestKit.makeStore()
        let a = try await store.createAccount(StoreTestKit.newAccount("A@X.com", aliases: ["Alias@X.com"]))
        #expect(a.email == "a@x.com")
        #expect(a.aliases == ["alias@x.com"])
        #expect(a.enabled)
        #expect(a.showInUnified)
        #expect(try await store.account(id: a.id) == a)
        #expect(try await store.account(email: "A@x.com")?.id == a.id)
        let b = try await store.createAccount(StoreTestKit.newAccount("b@x.com", provider: .gmail, authKind: .oauthGoogle))
        #expect(b.sortOrder == 1)
        let u = try await store.updateAccount(a.id, AccountPatch(name: "Ann", color: .some("#fff"), sortOrder: 5, enabled: false, aliases: ["z@x.com"]))
        #expect(u.name == "Ann" && u.color == "#fff" && !u.enabled && u.aliases == ["z@x.com"] && u.sortOrder == 5)
        #expect(try await store.listAccounts().map(\.id) == [b.id, a.id])
        #expect(try await store.ownAddresses() == ["a@x.com", "b@x.com", "z@x.com"])
        let cleared = try await store.updateAccount(a.id, AccountPatch(color: .some(nil), avatarSource: .some(.google), avatarUpdatedAt: .some(99)))
        #expect(cleared.color == nil && cleared.avatarSource == .google && cleared.avatarUpdatedAt == 99)
        let moved = try await store.updateAccount(a.id, AccountPatch(server: StoreTestKit.server, showInUnified: false))
        #expect(moved.server == StoreTestKit.server && !moved.showInUnified)
        try await store.deleteAccount(a.id)
        #expect(try await store.account(id: a.id) == nil)
    }

    @Test func rejectsDuplicatesAndUnknownIds() async throws {
        let store = try StoreTestKit.makeStore()
        _ = try await StoreTestKit.seedImap(store)
        await expectStoreError(.conflict) { _ = try await StoreTestKit.seedImap(store) }
        await expectStoreError(.notFound, "no longer exists") { _ = try await store.updateAccount("nope", AccountPatch(name: "x")) }
    }

    @Test func deletingAnAccountRemovesMailAndSearchRows() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        _ = try await StoreTestKit.ingest(store, s, s.inbox, StoreTestKit.msg(1) { $0.subject = "findme"; $0.textBody = "alpha" })
        #expect(try await store.accountHasMessages(s.account.id))
        try await store.deleteAccount(s.account.id)
        #expect(try await StoreTestKit.count(store, "SELECT COUNT(*) FROM messages") == 0)
        #expect(try await StoreTestKit.count(store, "SELECT COUNT(*) FROM threads") == 0)
        #expect(try await StoreTestKit.count(store, "SELECT COUNT(*) FROM messages_fts WHERE messages_fts MATCH 'alpha'") == 0)
    }

    @Test func upsertsByPathKeepsRoleCountsUnreadAndTotal() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        let again = try await store.upsertFolder(s.account.id, FolderInput(path: "INBOX", name: "Inbox"))
        #expect(again.id == s.inbox.id && again.role == .inbox)
        #expect(try await store.folder(accountId: s.account.id, role: .sent)?.id == s.sent.id)
        #expect(try await store.folder(accountId: s.account.id, role: .all) == nil)
        _ = try await StoreTestKit.ingest(store, s, s.inbox, StoreTestKit.msg(1), StoreTestKit.msg(2) { $0.flags = StoreTestKit.seen })
        let inbox = try #require(try await store.listFolders(accountId: s.account.id).first { $0.path == "INBOX" })
        #expect(inbox.unread == 1 && inbox.total == 2 && inbox.name == "Inbox")
    }

    @Test func derivesAFolderNameFromItsPath() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        let f = try await store.upsertFolder(s.account.id, FolderInput(path: "Clients.Acme", delimiter: "."))
        #expect(f.name == "Acme")
        let g = try await store.upsertFolder(s.account.id, FolderInput(path: "Clients/Beta"))
        #expect(g.name == "Beta")
    }

    @Test func storesAndReturnsSyncState() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        #expect(try await store.folderSyncState(s.inbox.id) == FolderSyncState())
        try await store.setFolderSyncState(s.inbox.id, FolderSyncPatch(uidValidity: .some(7), uidNext: .some(100), highestModseq: .some("123456789012"), syncedMinUid: .some(5), lastSyncAt: .some(9)))
        try await store.setFolderSyncState(s.inbox.id, FolderSyncPatch(uidNext: .some(101)))
        #expect(try await store.folderSyncState(s.inbox.id) == FolderSyncState(uidValidity: 7, uidNext: 101, highestModseq: "123456789012", syncedMinUid: 5, lastSyncAt: 9))
        try await store.setFolderSyncState(s.inbox.id, FolderSyncPatch(highestModseq: .some(nil)))
        #expect(try await store.folderSyncState(s.inbox.id).highestModseq == nil)
        await expectStoreError(.notFound) { _ = try await store.folderSyncState(9999) }
    }

    @Test func resetFolderDeletesItsMessagesAndSyncState() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        _ = try await StoreTestKit.ingest(store, s, s.inbox, StoreTestKit.msg(1) { $0.subject = "gone"; $0.textBody = "zebra" })
        _ = try await StoreTestKit.ingest(store, s, s.sent, StoreTestKit.msg(1) { $0.subject = "stays"; $0.from = [StoreTestKit.me()]; $0.to = [StoreTestKit.person("Bob")] })
        try await store.setFolderSyncState(s.inbox.id, FolderSyncPatch(uidValidity: .some(1), uidNext: .some(2)))
        let threads = try await store.resetFolder(s.inbox.id)
        #expect(threads.count == 1)
        #expect(try await store.listLocalUids(s.inbox.id, minUid: 0) == [])
        #expect(try await store.listLocalUids(s.sent.id, minUid: 0) == [1])
        #expect(try await store.folderSyncState(s.inbox.id).uidValidity == nil)
        #expect(try await StoreTestKit.count(store, "SELECT COUNT(*) FROM messages_fts WHERE messages_fts MATCH 'zebra'") == 0)
        #expect(try await StoreTestKit.count(store, "SELECT COUNT(*) FROM threads") == 1)
    }

    @Test func ensureFolderCreatesArchiveButNotAllMail() async throws {
        let store = try StoreTestKit.makeStore()
        let a = try await store.createAccount(StoreTestKit.newAccount("x@x.com"))
        let archive = try await store.ensureFolder(accountId: a.id, role: .archive)
        #expect(archive.path == "Archive" && archive.role == .archive)
        #expect(try await store.ensureFolder(accountId: a.id, role: .archive).id == archive.id)
        await expectStoreError(.notFound) { _ = try await store.ensureFolder(accountId: a.id, role: .all) }
    }

    @Test func settingsMigrationsAreAppliedInOrder() async throws {
        let store = try StoreTestKit.makeStore()
        let applied = try await StoreTestKit.strings(store, "SELECT identifier FROM grdb_migrations ORDER BY rowid")
        #expect(applied.count == 8)
        #expect(applied.first == "v1_initial" && applied.last == "v8_signature_account_ids")
        // Columns added by migrations 4 to 8 exist.
        #expect(try await StoreTestKit.count(store, "SELECT COUNT(*) FROM pragma_table_info('accounts') WHERE name IN ('show_in_unified','avatar_source','avatar_updated_at')") == 3)
        #expect(try await StoreTestKit.count(store, "SELECT COUNT(*) FROM pragma_table_info('messages') WHERE name = 'category_source'") == 1)
        #expect(try await StoreTestKit.count(store, "SELECT COUNT(*) FROM pragma_table_info('drafts') WHERE name = 'server_message_id'") == 1)
        #expect(try await StoreTestKit.count(store, "SELECT COUNT(*) FROM pragma_table_info('signatures') WHERE name = 'account_ids'") == 1)
        #expect(try await StoreTestKit.count(store, "SELECT COUNT(*) FROM pragma_table_info('tracked_messages') WHERE name = 'untracked_reason'") == 1)
    }
}
