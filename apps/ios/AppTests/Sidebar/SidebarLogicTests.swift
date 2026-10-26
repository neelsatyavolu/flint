@testable import Flint
import FlintModel
import Testing

@Suite("Sidebar logic")
struct SidebarLogicTests {
    private func account(_ id: String, provider: MailProvider = .imap) -> Account {
        Account(
            id: id, email: "\(id)@example.com", name: id, provider: provider, authKind: .password,
            server: ServerConfig(imapHost: "h", imapPort: 993, imapSecure: true, smtpHost: "h", smtpPort: 465, smtpSecure: true, username: id))
    }

    private func folder(_ id: Int, _ name: String, role: MailboxRole? = nil, unread: Int = 0) -> Folder {
        Folder(id: id, accountId: "a", path: name, name: name, role: role, unread: unread)
    }

    private func status(_ id: String, _ state: SyncState, error: String? = nil, last: EpochMs? = nil, progress: SyncProgress? = nil) -> SyncStatus {
        SyncStatus(accountId: id, state: state, error: error, lastSyncAt: last, progress: progress)
    }

    @Test("lists come in the desktop order with live counts")
    func listsOrderAndCounts() {
        let counts = SidebarCounts(inbox: 7, pinned: 2, drafts: 3, snoozed: 1, scheduled: 4, spam: 5)
        let lists = SidebarLogic.lists(counts: counts)
        #expect(lists.map(\.selection) == [.unifiedInbox, .pinned, .drafts, .sent, .scheduled, .snoozed, .trash, .spam])
        #expect(lists.map(\.count) == [7, 2, 3, 0, 4, 1, 0, 5])
        #expect(Set(lists.map(\.id)).count == lists.count)
    }

    @Test("more folders keep labels and uncovered roles, drop roles with their own row")
    func moreFolders() {
        let all = [
            folder(1, "INBOX", role: .inbox), folder(2, "Sent", role: .sent), folder(3, "Trash", role: .trash),
            folder(4, "Zed"), folder(5, "Alpha"), folder(6, "All Mail", role: .all), folder(7, "Archive", role: .archive),
        ]
        #expect(SidebarLogic.moreFolders(all).map(\.name) == ["All Mail", "Alpha", "Zed"])
    }

    @Test("folder names sort the way people read them")
    func moreFoldersNaturalOrder() {
        let list = [folder(1, "Project 10"), folder(2, "Project 2")]
        #expect(SidebarLogic.moreFolders(list).map(\.name) == ["Project 2", "Project 10"])
    }

    @Test("accounts without extra folders get no group")
    func folderGroups() {
        let data = SidebarData(
            accounts: [
                SidebarAccount(account: account("a"), inboxUnread: 1, folders: [folder(1, "INBOX", role: .inbox)], sync: status("a", .idle)),
                SidebarAccount(account: account("b"), inboxUnread: 0, folders: [folder(2, "Receipts")], sync: status("b", .idle)),
            ],
            counts: SidebarCounts())
        #expect(SidebarLogic.folderGroups(data).map(\.id) == ["b"])
        #expect(SidebarLogic.folderGroups(nil).isEmpty)
    }

    @Test("a problem beats syncing, and says what to do")
    func problemsFirst() {
        let line = SidebarLogic.syncLine(
            accounts: [account("a"), account("b"), account("c")],
            statuses: [status("a", .syncing), status("b", .offline), status("c", .authError)])
        guard case .problems(let problems) = line else { Issue.record("expected problems, got \(line)"); return }
        #expect(problems.map(\.kind) == [.offline, .signIn])
        #expect(problems.map(\.accountId) == ["b", "c"])
    }

    @Test("an error keeps the engine's text only when there is some")
    func failedDetail() {
        let line = SidebarLogic.syncLine(
            accounts: [account("a"), account("b")], statuses: [status("a", .error, error: "Server busy"), status("b", .error, error: "")])
        guard case .problems(let problems) = line else { Issue.record("expected problems"); return }
        #expect(problems.map(\.kind) == [.failed("Server busy"), .failed(nil)])
    }

    @Test("syncing adds up progress across accounts")
    func syncingProgress() {
        let line = SidebarLogic.syncLine(
            accounts: [account("a"), account("b")],
            statuses: [status("a", .syncing, progress: SyncProgress(done: 10, total: 40)), status("b", .syncing, progress: SyncProgress(done: 5, total: 10))])
        #expect(line == .syncing(done: 15, total: 50))
        #expect(SidebarLogic.syncLine(accounts: [account("a")], statuses: [status("a", .syncing)]) == .syncing(done: nil, total: nil))
    }

    @Test("idle shows the latest sync, and nothing before the first one")
    func updatedOrQuiet() {
        let accounts = [account("a"), account("b")]
        #expect(SidebarLogic.syncLine(accounts: accounts, statuses: [status("a", .idle, last: 100), status("b", .idle, last: 300)]) == .updated(300))
        #expect(SidebarLogic.syncLine(accounts: accounts, statuses: [status("a", .idle)]) == .quiet)
        #expect(SidebarLogic.syncLine(accounts: accounts, statuses: []) == .quiet)
    }

    @Test("statuses of removed accounts are ignored")
    func removedAccounts() {
        #expect(SidebarLogic.syncLine(accounts: [account("a")], statuses: [status("gone", .offline)]) == .quiet)
    }

    @Test("live statuses win over the snapshot copy")
    func liveWins() {
        let data = SidebarData(
            accounts: [
                SidebarAccount(account: account("a"), inboxUnread: 0, folders: [], sync: status("a", .idle)),
                SidebarAccount(account: account("b"), inboxUnread: 0, folders: [], sync: status("b", .offline)),
            ],
            counts: SidebarCounts())
        let merged = SidebarLogic.statuses(live: [status("a", .syncing)], data: data)
        #expect(merged.map(\.state) == [.syncing, .offline])
    }
}
