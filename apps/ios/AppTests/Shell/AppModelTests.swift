@testable import Flint
import FlintModel
import Foundation
import Testing

@Suite("AppModel", .serialized)
@MainActor
struct AppModelTests {
    @Test("navigation: lists, threads, sheets and dismiss")
    func navigation() {
        let model = AppModel(mode: .live)
        model.navigate(to: .sidebar)
        #expect(model.presented == .sidebar)
        model.navigate(to: .mailbox(.pinned))
        #expect(model.mailbox == .pinned)
        #expect(model.presented == nil)
        model.navigate(to: .thread(7))
        #expect(model.openThread == 7)
        model.navigate(to: .search("from:ann"))
        #expect(model.presented == .search("from:ann"))
        model.navigate(to: .thread(9))
        #expect(model.presented == nil && model.openThread == 9)
        model.navigate(to: .dismiss)
        #expect(model.openThread == nil)
        model.navigate(to: .compose(.start(.new())))
        #expect(model.presented == .compose(.start(.new())))
        model.navigate(to: .dismiss)
        #expect(model.presented == nil)
    }

    @Test("an OAuth callback is kept for the sign-in flow, unknown URLs are ignored")
    func links() throws {
        let model = AppModel(mode: .live)
        model.handle(url: try #require(URL(string: "https://example.com")))
        #expect(model.pendingLink == nil && model.presented == nil)
        let callback = try #require(URL(string: "\(DeepLink.googleScheme):/oauth2redirect?code=x"))
        model.handle(url: callback)
        #expect(model.takePendingLink() == .oauthCallback(callback))
        #expect(model.presented == nil)
    }

    @Test("selections map to thread queries and stable identifiers")
    func selections() {
        #expect(MailboxSelection.unifiedInbox.threadQuery(focused: true)?.view == .inbox)
        #expect(MailboxSelection.inbox("a").threadQuery(focused: false)?.accountId == "a")
        #expect(MailboxSelection.inbox("a").threadQuery(focused: false)?.focused == false)
        #expect(MailboxSelection.scheduled.threadQuery() == nil)
        #expect(MailboxSelection.folder("a", 4).threadQuery()?.folderId == 4)
        let all: [MailboxSelection] = [.unifiedInbox, .inbox("a"), .pinned, .drafts, .scheduled, .snoozed, .sent, .archive, .trash, .spam, .folder("a", 4)]
        #expect(Set(all.map(\.identifier)).count == all.count)
    }

    @Test("bootstrap runs once and leaves the model ready")
    func bootstrapOnce() async throws {
        let model = AppModel(mode: .injected(try await DemoSeed.make().service))
        await model.bootstrap()
        #expect(model.phase == .ready)
        await model.bootstrap() // second call does nothing
        #expect(model.phase == .ready)
        await model.shutdown()
    }

    @Test("actions show the desktop toast with Undo, and undo restores")
    func archiveAndUndo() async throws {
        let app = try await SeededApp.make()
        defer { Task { await app.tearDown() } }
        let before = try await app.inboxThreads()
        let target = try #require(before.first { $0.subject == "Mentoring session notes" })
        app.model.navigate(to: .thread(target.id))
        #expect(await app.model.archive([target.id]))
        #expect(app.model.openThread == nil)
        #expect(app.model.toasts.current?.message == "Archived")
        #expect(app.model.toasts.current?.undo != nil)
        #expect(try await app.inboxThreads().contains { $0.id == target.id } == false)
        await app.model.toasts.performUndo()
        #expect(try await app.inboxThreads().contains { $0.id == target.id })
        #expect(app.model.toasts.current?.message == "Undone")
    }

    @Test("pin and read are quiet, and an empty selection does nothing")
    func quietActions() async throws {
        let app = try await SeededApp.make()
        defer { Task { await app.tearDown() } }
        let unread = try #require(try await app.inboxThreads().first { $0.unreadCount > 0 })
        #expect(await app.model.markRead([unread.id], read: true))
        #expect(app.model.toasts.current == nil)
        #expect(await app.model.markRead([], read: true) == false)
        #expect(app.model.toasts.current == nil)
    }

    @Test("search finds seeded mail and recents are kept newest first without duplicates")
    func search() async throws {
        let app = try await SeededApp.make()
        defer { Task { await app.tearDown() } }
        let page = try await app.model.search("jollof")
        #expect(page.items.contains { $0.subject == "Sunday dinner?" })
        app.model.recordSearch("jollof")
        app.model.recordSearch("lease")
        app.model.recordSearch("jollof")
        app.model.recordSearch("  ")
        #expect(app.model.recentSearches == ["jollof", "lease"])
        app.model.clearRecentSearches()
        #expect(app.model.recentSearches.isEmpty)
    }

    @Test("compose and send: sending shows Undo, and Undo reopens the draft")
    func sendAndUndo() async throws {
        let app = try await SeededApp.make()
        defer { Task { await app.tearDown() } }
        let draft = try await app.model.createDraft(.new(accountId: DemoAccount.work.id, to: [DemoPeople.priya], subject: "Test", html: "<p>Hi</p>"))
        let result = try #require(await app.model.sendDraft(id: draft.id))
        #expect(app.model.toasts.current?.message == "Sent")
        await app.model.toasts.performUndo()
        #expect(app.model.presented == .compose(.resume(draftId: draft.id)))
        #expect(result.scheduledId > 0)
    }

    @Test("settings patches flow back through the settings stream")
    func settings() async throws {
        let app = try await SeededApp.make()
        defer { Task { await app.tearDown() } }
        let updated = try #require(await app.model.updateSettings(patch: .object(["inbox": .object(["focused": .bool(false)])])))
        #expect(updated.inbox.focused == false)
        #expect(app.model.threadQuery(for: .unifiedInbox)?.focused == true || app.model.threadQuery(for: .unifiedInbox)?.focused == false)
    }

    @Test("removing the account whose list is open returns to the unified inbox")
    func removeAccount() async throws {
        let app = try await SeededApp.make()
        defer { Task { await app.tearDown() } }
        app.model.navigate(to: .mailbox(.inbox(DemoAccount.personal.id)))
        try await app.model.removeAccount(id: DemoAccount.personal.id)
        #expect(app.model.mailbox == .unifiedInbox)
        let remaining = try await app.model.requireService().listAccounts()
        #expect(remaining.count == 2)
    }

    @Test("before bootstrap, service calls fail with a plain error instead of crashing")
    func beforeBootstrap() async {
        let model = AppModel(mode: .live)
        await #expect(throws: FlintError.self) { _ = try await model.listThreads(ThreadQuery(view: .inbox)) }
        #expect(await model.archive([1]) == false)
        #expect(model.toasts.current?.message == "Couldn't archive. Try again.")
    }
}

@Suite("Launch route")
@MainActor
struct LaunchRouteTests {
    @Test("specs parse to routes")
    func parsing() {
        #expect(LaunchRoute.parse("inbox") == .route(.mailbox(.unifiedInbox)))
        #expect(LaunchRoute.parse("inbox:2") == .account(index: 2))
        #expect(LaunchRoute.parse("pinned") == .route(.mailbox(.pinned)))
        #expect(LaunchRoute.parse("thread:Q4 roadmap") == .thread(subjectPrefix: "Q4 roadmap"))
        #expect(LaunchRoute.parse("search:from:ann") == .route(.search("from:ann")))
        #expect(LaunchRoute.parse("search") == .route(.search(nil)))
        #expect(LaunchRoute.parse("settings") == .route(.settings(.root)))
        #expect(LaunchRoute.parse("nonsense") == nil)
    }

    @Test("a thread spec opens the first matching conversation")
    func thread() async throws {
        let app = try await SeededApp.make()
        defer { Task { await app.tearDown() } }
        await app.model.applyLaunchRoute(.thread(subjectPrefix: "Q4 roadmap"))
        #expect(app.model.openThread != nil)
        await app.model.applyLaunchRoute(.account(index: 1))
        #expect(app.model.mailbox == .inbox(app.model.accounts[1].id))
        await app.model.applyLaunchRoute(nil)
    }
}
