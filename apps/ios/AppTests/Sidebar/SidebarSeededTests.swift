@testable import Flint
import FlintModel
import Testing

@Suite("Sidebar over the demo mailbox")
@MainActor
struct SidebarSeededTests {
    @Test("the demo sidebar has three accounts with unread counts that add up to the inbox")
    func accountsAndCounts() async throws {
        let app = try await SeededApp.make()
        defer { Task { await app.tearDown() } }
        let data = try #require(app.model.sidebar)
        #expect(data.accounts.count == 3)
        #expect(data.counts.inbox > 0)
        #expect(data.accounts.map(\.inboxUnread).reduce(0, +) >= data.counts.inbox)
        let lists = SidebarLogic.lists(counts: data.counts)
        #expect(lists.first?.count == data.counts.inbox)
        #expect(lists.first { $0.selection == .pinned }?.count == 2)
    }

    @Test("tapping an account selects its inbox and closes the sheet")
    func switchAccount() async throws {
        let app = try await SeededApp.make()
        defer { Task { await app.tearDown() } }
        let id = try #require(app.model.accounts.last?.id)
        app.model.navigate(to: .sidebar)
        #expect(app.model.presented == .sidebar)
        app.model.navigate(to: .mailbox(.inbox(id)))
        #expect(app.model.mailbox == .inbox(id))
        #expect(app.model.presented == nil)
        #expect(app.model.title(for: .inbox(id)).isEmpty == false)
    }

    @Test("every fixed row and folder row has a distinct identifier")
    func identifiersAreUnique() async throws {
        let app = try await SeededApp.make()
        defer { Task { await app.tearDown() } }
        let data = try #require(app.model.sidebar)
        let lists = SidebarLogic.lists(counts: data.counts).map(\.selection.identifier)
        let accounts = data.accounts.map { MailboxSelection.inbox($0.id).identifier }
        let folders = SidebarLogic.folderGroups(data).flatMap { group in group.folders.map { MailboxSelection.folder($0.accountId, $0.id).identifier } }
        let all = lists + accounts + folders + [MailboxSelection.archive.identifier]
        #expect(Set(all).count == all.count)
    }

    @Test("sync status of a healthy demo is never a problem")
    func healthySync() async throws {
        let app = try await SeededApp.make()
        defer { Task { await app.tearDown() } }
        let line = SidebarLogic.syncLine(accounts: app.model.accounts, statuses: SidebarLogic.statuses(live: app.model.syncStatuses, data: app.model.sidebar))
        if case .problems(let problems) = line { Issue.record("unexpected problems: \(problems.map(\.kind))") }
    }
}
